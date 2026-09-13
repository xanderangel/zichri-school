const prisma = require("../lib/prisma");
const { recordAudit } = require("../services/audit.service");

async function getMyProfile(req, res) {
  const teacher = await prisma.teacher.findUnique({
    where: { userId: req.user.id },
    include: {
      user: { select: { username: true, accountStatus: true } },
      classAssignments: { where: { removedAt: null, isPrimary: true }, include: { class: true }, take: 1 },
    },
  });
  if (!teacher) return res.status(404).json({ error: "Teacher profile not found" });

  res.json({
    teacher: {
      id: teacher.id,
      fullName: teacher.fullName,
      email: teacher.email,
      username: teacher.user.username,
      accountStatus: teacher.user.accountStatus,
      profileImageId: teacher.profileImageId,
      // Drives the "prompt for profile picture after first login" flow —
      // no schema flag needed, absence of an image IS the signal.
      needsProfilePicture: !teacher.profileImageId,
      class: teacher.classAssignments[0]?.class || null,
    },
  });
}

/** Called by the multer-parsed upload route in teacher.routes.js. req.file.buffer holds the image bytes directly in memory (multer.memoryStorage) — never touches disk. */
async function setProfilePicture(req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.id } });
  if (!teacher) return res.status(404).json({ error: "Teacher profile not found" });
  const oldProfileImageId = teacher.profileImageId; // capture before it's replaced below

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

  await prisma.teacher.update({ where: { id: teacher.id }, data: { profileImageId: fileRow.id } });
  await recordAudit({ actorUserId: req.user.id, action: "PROFILE_UPDATED", targetType: "Teacher", targetId: teacher.id });

  // Clean up the photo this one replaced — nothing points to it anymore,
  // and leaving it behind would just quietly accumulate storage forever
  // every time someone updates their picture. Best-effort: if it's
  // already gone for any reason, that's fine, nothing to do.
  if (oldProfileImageId) {
    await prisma.uploadedFile.delete({ where: { id: oldProfileImageId } }).catch(() => {});
  }

  res.json({ ok: true, profileImageId: fileRow.id });
}

module.exports = { getMyProfile, setProfilePicture };
