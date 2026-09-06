const { z } = require("zod");
const prisma = require("../lib/prisma");
const { hashPassword } = require("../lib/hash");
const { recordAudit } = require("../services/audit.service");

// Teacher and student accounts start life here as self-registrations that
// land in PENDING status. They cannot use main functionality until an
// admin flips them to VERIFIED (see admin.controller.verifyAccount).

const teacherRegSchema = z.object({
  fullName: z.string().min(1),
  username: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(8),
  classId: z.string().min(1), // required — must be one of Admin's existing classes
});

async function registerTeacher(req, res) {
  const parsed = teacherRegSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const { fullName, username, email, password, classId } = parsed.data;

  const klass = await prisma.class.findUnique({ where: { id: classId } });
  if (!klass || klass.archived) return res.status(400).json({ error: "Selected class is not valid" });

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return res.status(409).json({ error: "Username already taken" });
  const existingEmail = await prisma.teacher.findUnique({ where: { email } });
  if (existingEmail) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        username,
        passwordHash,
        role: "TEACHER",
        accountStatus: "PENDING",
      },
    });
    const teacher = await tx.teacher.create({
      data: { userId: u.id, fullName, email },
    });
    await tx.classAssignment.create({
      data: { teacherId: teacher.id, classId, isPrimary: true },
    });
    return u;
  });

  await recordAudit({
    actorUserId: user.id,
    action: "ACCOUNT_CREATED",
    targetType: "Teacher",
    targetId: user.id,
    metadata: { role: "TEACHER" },
  });

  res.status(201).json({ ok: true, message: "Registration submitted. Awaiting admin verification." });
}

// Registration collects only the account essentials (per phase 4 spec) —
// name, DOB, state, sex, religion, and photo are captured afterward by
// the first-login setup wizard once Admin has verified the account.
const studentRegSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(8),
});

async function registerStudent(req, res) {
  const parsed = studentRegSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const d = parsed.data;

  const existing = await prisma.user.findUnique({ where: { username: d.username } });
  if (existing) return res.status(409).json({ error: "Username already taken" });
  const existingEmail = await prisma.student.findUnique({ where: { email: d.email } });
  if (existingEmail) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await hashPassword(d.password);

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { username: d.username, passwordHash, role: "STUDENT", accountStatus: "PENDING" },
    });
    await tx.student.create({
      data: { userId: u.id, email: d.email },
    });
    return u;
  });

  await recordAudit({
    actorUserId: user.id,
    action: "ACCOUNT_CREATED",
    targetType: "Student",
    targetId: user.id,
    metadata: { role: "STUDENT" },
  });

  res.status(201).json({ ok: true, message: "Registration submitted. Awaiting admin verification." });
}

module.exports = { registerTeacher, registerStudent };
