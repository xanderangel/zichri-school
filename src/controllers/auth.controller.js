const { z } = require("zod");
const { nanoid } = require("nanoid");
const prisma = require("../lib/prisma");
const { hashPassword, verifyPassword } = require("../lib/hash");
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} = require("../lib/jwt");
const { recordAudit } = require("../services/audit.service");
const { sendMail } = require("../services/mailer.service");
const { resolveLoginUser } = require("../lib/identifierResolver");

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

const loginSchema = z.object({
  username: z.string().min(1), // may be a username (admin) or an email (teacher/student)
  password: z.string().min(1),
});

async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "username and password are required" });
  const { username, password } = parsed.data;

  const user = await resolveLoginUser(username);

  // Deliberately identical error for "no such user" and "wrong password"
  // so login cannot be used to enumerate valid usernames.
  const genericError = () => res.status(401).json({ error: "Invalid username or password" });

  if (!user) return genericError();

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return res.status(423).json({ error: "Account temporarily locked. Try again later." });
  }

  if (user.accountStatus === "REMOVED") {
    return res.status(403).json({ error: "This account has been removed" });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failedLoginCount = user.failedLoginCount + 1;
    const lockedUntil =
      failedLoginCount >= MAX_FAILED_LOGINS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        : null;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount, lockedUntil },
    });
    return genericError();
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken,
      userAgent: req.headers["user-agent"] || null,
      ipAddress: req.ip,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  await recordAudit({
    actorUserId: user.id,
    action: "LOGIN_SUCCESS",
    targetType: "User",
    targetId: user.id,
    ipAddress: req.ip,
  });

  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      accountStatus: user.accountStatus,
      // Forces the frontend to route straight to the security-setup flow.
      mustCompleteAdminSecuritySetup:
        user.role === "ADMIN" && !user.admin?.securitySetupCompletedAt,
      mustChangePassword: user.mustChangePassword,
    },
  });
}

async function refresh(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: "refreshToken is required" });

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }

  const session = await prisma.session.findUnique({ where: { refreshToken } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    return res.status(401).json({ error: "Session no longer valid" });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.accountStatus === "REMOVED") {
    return res.status(401).json({ error: "Account unavailable" });
  }

  const accessToken = signAccessToken(user);
  res.json({ accessToken });
}

async function logout(req, res) {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await prisma.session.updateMany({
      where: { refreshToken },
      data: { revokedAt: new Date() },
    });
  }
  res.json({ ok: true });
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

async function changePassword(req, res) {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  // Revoke all other sessions so a leaked old session token stops working
  // the moment the password changes.
  await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await recordAudit({
    actorUserId: user.id,
    action: "PASSWORD_CHANGED",
    targetType: "User",
    targetId: user.id,
  });

  res.json({ ok: true });
}

// --------------------------------------------------------------------------
// ADMIN FORCED FIRST-LOGIN SECURITY SETUP
// --------------------------------------------------------------------------

const recoverySetupSchema = z.object({
  recoveryEmail1: z.string().email(),
  recoveryEmail2: z.string().email(),
  newPassword: z.string().min(8),
});

/**
 * Step 1 of admin bootstrap security: submit both recovery emails and a
 * new password. This does NOT yet mark setup complete — that only happens
 * once BOTH emails are verified via verifyRecoveryEmail below. Verification
 * tokens are emailed out from here (email sending itself is stubbed for
 * this phase — see services/mailer.js).
 */
async function submitAdminSecuritySetup(req, res) {
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Admins only" });
  const parsed = recoverySetupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  if (parsed.data.recoveryEmail1 === parsed.data.recoveryEmail2) {
    return res.status(400).json({ error: "Recovery emails must be different" });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: req.user.id },
      data: { passwordHash, mustChangePassword: false },
    });
    await tx.adminProfile.update({
      where: { userId: req.user.id },
      data: {
        recoveryEmail1: parsed.data.recoveryEmail1,
        recoveryEmail1Verified: false,
        recoveryEmail2: parsed.data.recoveryEmail2,
        recoveryEmail2Verified: false,
      },
    });
    for (const [purpose, target] of [
      ["RECOVERY_EMAIL_1", parsed.data.recoveryEmail1],
      ["RECOVERY_EMAIL_2", parsed.data.recoveryEmail2],
    ]) {
      await tx.verificationToken.create({
        data: {
          userId: req.user.id,
          purpose,
          target,
          token: nanoid(32),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }
  });

  // TODO (next phase): actually send the verification emails via the
  // mailer service once email sending is configured.

  await recordAudit({
    actorUserId: req.user.id,
    action: "ADMIN_SECURITY_SETUP_SUBMITTED",
    targetType: "User",
    targetId: req.user.id,
  });

  res.json({ ok: true, message: "Verification emails queued. Verify both to complete setup." });
}

async function verifyRecoveryEmail(req, res) {
  const { token } = req.params;
  const vt = await prisma.verificationToken.findUnique({ where: { token } });
  if (!vt || vt.usedAt || vt.expiresAt < new Date()) {
    return res.status(400).json({ error: "Invalid or expired verification link" });
  }
  if (!["RECOVERY_EMAIL_1", "RECOVERY_EMAIL_2"].includes(vt.purpose)) {
    return res.status(400).json({ error: "Wrong token type" });
  }

  const field = vt.purpose === "RECOVERY_EMAIL_1" ? "recoveryEmail1Verified" : "recoveryEmail2Verified";

  await prisma.$transaction(async (tx) => {
    await tx.verificationToken.update({ where: { token }, data: { usedAt: new Date() } });
    await tx.adminProfile.update({ where: { userId: vt.userId }, data: { [field]: true } });

    const profile = await tx.adminProfile.findUnique({ where: { userId: vt.userId } });
    if (profile.recoveryEmail1Verified && profile.recoveryEmail2Verified && !profile.securitySetupCompletedAt) {
      await tx.adminProfile.update({
        where: { userId: vt.userId },
        data: { securitySetupCompletedAt: new Date() },
      });
    }
  });

  await recordAudit({
    actorUserId: vt.userId,
    action: "RECOVERY_EMAIL_VERIFIED",
    metadata: { purpose: vt.purpose },
  });

  res.json({ ok: true });
}

// --------------------------------------------------------------------------
// FORGOT PASSWORD / RESET (via verified recovery email)
// --------------------------------------------------------------------------

const forgotPasswordSchema = z.object({ username: z.string().min(1) });

/**
 * Only works for accounts with at least one VERIFIED recovery email
 * (currently: admin). Always responds with the same generic message
 * whether or not the username exists / has recovery emails, so this
 * endpoint can't be used to enumerate accounts.
 */
async function forgotPassword(req, res) {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "username is required" });

  const generic = { ok: true, message: "If that account can receive a reset email, one has been sent." };

  // Accepts a username (admin) or a teacher/student email — same
  // resolver login uses, so "forgot password" recognizes the same
  // identifiers a person can actually log in with.
  const user = await resolveLoginUser(parsed.data.username);
  if (!user) return res.json(generic);

  let target = null;
  if (user.role === "ADMIN" && user.admin) {
    // Admin resets only go to a VERIFIED recovery email — the extra layer
    // of proof makes sense for the one account with full system access.
    target = user.admin.recoveryEmail1Verified
      ? user.admin.recoveryEmail1
      : user.admin.recoveryEmail2Verified
      ? user.admin.recoveryEmail2
      : null;
  } else if (user.role === "TEACHER") {
    const teacher = await prisma.teacher.findUnique({ where: { userId: user.id } });
    target = teacher?.email || null;
  } else if (user.role === "STUDENT") {
    const student = await prisma.student.findUnique({ where: { userId: user.id } });
    target = student?.email || null;
  }
  if (!target) return res.json(generic);

  const token = nanoid(32);
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      purpose: "PASSWORD_RESET",
      target,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  await sendMail({
    to: target,
    subject: "Zichri School — Password Reset Request",
    html: `<p>A password reset was requested for account "${user.username}". Use this token to reset your password: <b>${token}</b> (valid 1 hour). If you did not request this, ignore this email.</p>`,
  });

  await recordAudit({ actorUserId: user.id, action: "PASSWORD_RESET_REQUESTED", targetType: "User", targetId: user.id });

  res.json(generic);
}

const resetPasswordSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(8) });

async function resetPassword(req, res) {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const vt = await prisma.verificationToken.findUnique({ where: { token: parsed.data.token } });
  if (!vt || vt.purpose !== "PASSWORD_RESET" || vt.usedAt || vt.expiresAt < new Date()) {
    return res.status(400).json({ error: "Invalid or expired reset token" });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: vt.userId }, data: { passwordHash, mustChangePassword: false } });
    await tx.verificationToken.update({ where: { token: vt.token }, data: { usedAt: new Date() } });
    await tx.session.updateMany({ where: { userId: vt.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  });

  await recordAudit({ actorUserId: vt.userId, action: "PASSWORD_RESET_COMPLETED", targetType: "User", targetId: vt.userId });

  res.json({ ok: true });
}

module.exports = {
  login,
  refresh,
  logout,
  changePassword,
  submitAdminSecuritySetup,
  verifyRecoveryEmail,
  forgotPassword,
  resetPassword,
};
