const prisma = require("../lib/prisma");
const { recordAudit } = require("../services/audit.service");

async function getClassDetail(req, res) {
  const { classId } = req.params;
  const klass = await prisma.class.findUnique({ where: { id: classId } });
  if (!klass) return res.status(404).json({ error: "Class not found" });

  const [teachers, students] = await Promise.all([
    prisma.classAssignment.findMany({
      where: { classId, removedAt: null },
      include: { teacher: { select: { id: true, fullName: true, profileImageId: true, user: { select: { accountStatus: true } } } } },
    }),
    prisma.student.findMany({
      where: { classId },
      select: { id: true, firstName: true, lastName: true, profileImageId: true, user: { select: { accountStatus: true } } },
    }),
  ]);

  res.json({
    class: klass,
    teachers: teachers.map((a) => ({ id: a.teacher.id, fullName: a.teacher.fullName, profileImageId: a.teacher.profileImageId, status: a.teacher.user.accountStatus })),
    students: students.map((s) => ({ id: s.id, fullName: `${s.firstName} ${s.lastName}`, profileImageId: s.profileImageId, status: s.user.accountStatus })),
  });
}

/**
 * Renaming is always safe — Class.id is the durable identifier every
 * other table references, so a rename never touches historical FKs
 * (this is exactly why the schema was built that way in phase 1).
 */
async function renameClass(req, res) {
  const { classId } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "New name is required" });

  const conflict = await prisma.class.findUnique({ where: { name } });
  if (conflict && conflict.id !== classId) return res.status(409).json({ error: "Another class already has this name" });

  const klass = await prisma.class.update({ where: { id: classId }, data: { name } });
  await recordAudit({ actorUserId: req.user.id, action: "CLASS_RENAMED", targetType: "Class", targetId: classId, metadata: { newName: name } });
  res.json({ class: klass });
}

/**
 * "Deletion" is always an archive (soft-delete) — the class row and its
 * id must survive forever because Spreadsheet/Student rows reference it,
 * and locked spreadsheets/report cards must remain readable. Archiving
 * just hides the class from "create new spreadsheet" pickers going
 * forward; nothing is destroyed.
 */
async function archiveClass(req, res) {
  const { classId } = req.params;
  const klass = await prisma.class.update({ where: { id: classId }, data: { archived: true } });
  await recordAudit({ actorUserId: req.user.id, action: "CLASS_ARCHIVED", targetType: "Class", targetId: classId });
  res.json({ class: klass });
}

module.exports = { getClassDetail, renameClass, archiveClass };
