const { z } = require("zod");
const prisma = require("../lib/prisma");
const { recordAudit } = require("../services/audit.service");

function isProfileComplete(student) {
  return !!(student.firstName && student.lastName && student.dateOfBirth && student.stateOfOrigin && student.sex && student.profileImageId);
}

async function getMyProfile(req, res) {
  const student = await prisma.student.findUnique({
    where: { userId: req.user.id },
    include: { user: { select: { username: true, accountStatus: true } }, class: true },
  });
  if (!student) return res.status(404).json({ error: "Student profile not found" });

  res.json({
    student: {
      id: student.id,
      username: student.user.username,
      email: student.email,
      accountStatus: student.user.accountStatus,
      firstName: student.firstName,
      middleName: student.middleName,
      lastName: student.lastName,
      dateOfBirth: student.dateOfBirth,
      stateOfOrigin: student.stateOfOrigin,
      sex: student.sex,
      religion: student.religion,
      profileImageId: student.profileImageId,
      className: student.class?.name || null,
      // Drives the first-login wizard — true until every required field
      // (names, DOB, state, sex, photo) has been filled in.
      needsProfileSetup: !isProfileComplete(student),
    },
  });
}

// Wizard page 1 + page 2 fields — accepted as one flexible PATCH so the
// frontend can save progressively as the student moves through pages
// without a separate endpoint per page.
const profileUpdateSchema = z.object({
  firstName: z.string().min(1).optional(),
  middleName: z.string().optional(),
  lastName: z.string().min(1).optional(),
  dateOfBirth: z.string().optional(), // ISO date string
  stateOfOrigin: z.string().min(1).optional(),
  sex: z.enum(["MALE", "FEMALE"]).optional(),
  religion: z.string().optional(),
});

async function updateMyProfile(req, res) {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const data = { ...parsed.data };
  if (data.dateOfBirth) data.dateOfBirth = new Date(data.dateOfBirth);

  const student = await prisma.student.update({ where: { userId: req.user.id }, data });
  await recordAudit({ actorUserId: req.user.id, action: "PROFILE_UPDATED", targetType: "Student", targetId: student.id });

  res.json({ ok: true, needsProfileSetup: !isProfileComplete(student) });
}

/** Wizard page 3 — completes the first-login flow once uploaded. */
async function setProfilePicture(req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const student = await prisma.student.findUnique({ where: { userId: req.user.id } });
  if (!student) return res.status(404).json({ error: "Student profile not found" });
  const oldProfileImageId = student.profileImageId; // capture before it's replaced below

  const fileRow = await prisma.uploadedFile.create({
    data: {
      ownerUserId: req.user.id,
      purpose: "PROFILE_IMAGE",
      data: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    },
  });

  const updated = await prisma.student.update({ where: { id: student.id }, data: { profileImageId: fileRow.id } });
  await recordAudit({ actorUserId: req.user.id, action: "PROFILE_UPDATED", targetType: "Student", targetId: student.id });

  // Clean up the photo this one replaced — see teacherProfile.controller.js for why.
  if (oldProfileImageId) {
    await prisma.uploadedFile.delete({ where: { id: oldProfileImageId } }).catch(() => {});
  }

  res.json({ ok: true, profileImageId: fileRow.id, needsProfileSetup: !isProfileComplete(updated) });
}

module.exports = { getMyProfile, updateMyProfile, setProfilePicture };
