const prisma = require("../lib/prisma");
const { recordAudit } = require("../services/audit.service");

/** A student's name may still be null (first-login wizard not completed yet) — fall back to their username so admin views never show a bare "null null". */
function displayName(student, username) {
  if (student.firstName || student.lastName) return `${student.firstName || ""} ${student.lastName || ""}`.trim();
  return username;
}

async function listStudents(req, res) {
  const { status } = req.query;
  const students = await prisma.student.findMany({
    where: { user: { accountStatus: status || "VERIFIED" } },
    include: { user: { select: { username: true, accountStatus: true } }, class: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({
    students: students.map((s) => ({
      id: s.id,
      fullName: displayName(s, s.user.username),
      profileImageId: s.profileImageId,
      className: s.class?.name || null,
      status: s.user.accountStatus,
    })),
  });
}

/**
 * Student profile + report card history, newest first. Report cards are
 * read from the ReportCard table's own snapshot fields, not joined back
 * to the student's current profile — so removing/editing the student
 * later never rewrites what's shown here for a past term.
 */
async function getStudentProfile(req, res) {
  // req.targetStudent is already loaded + ownership-checked by
  // requireOwnStudentRecord for the student-self route; admin route
  // loads directly here since admin can view any student.
  const { studentId } = req.params;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { user: { select: { id: true, username: true, accountStatus: true, createdAt: true } }, class: true, profileImage: true },
  });
  if (!student) return res.status(404).json({ error: "Student not found" });

  const reportCards = await prisma.reportCard.findMany({
    where: { studentId },
    include: {
      spreadsheetVersion: { select: { versionNumber: true } },
      deliveryRecords: { select: { channel: true, status: true, deliveredAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    student: {
      id: student.id,
      userId: student.user.id,
      firstName: student.firstName,
      middleName: student.middleName,
      lastName: student.lastName,
      dateOfBirth: student.dateOfBirth,
      stateOfOrigin: student.stateOfOrigin,
      sex: student.sex,
      profileImageId: student.profileImageId,
      username: student.user.username,
      accountStatus: student.user.accountStatus,
      className: student.class?.name || null,
      createdAt: student.user.createdAt,
    },
    reportCards: reportCards.map((rc) => ({
      id: rc.id,
      className: rc.snapshotClassName,
      sessionName: rc.snapshotSessionName,
      termName: rc.snapshotTermName,
      versionNumber: rc.spreadsheetVersion.versionNumber,
      issuedAt: rc.issuedAt,
      deliveries: rc.deliveryRecords,
    })),
  });
}

module.exports = { listStudents, getStudentProfile, assignStudentClass };

/**
 * Students no longer pick a class at registration (phase 4 spec keeps
 * registration to username/email/password only), so Admin needs a way to
 * place a verified student into a class. Small, additive endpoint — does
 * not touch any existing flow.
 */
async function assignStudentClass(req, res) {
  const { studentId } = req.params;
  const { classId } = req.body;
  if (!classId) return res.status(400).json({ error: "classId is required" });

  const klass = await prisma.class.findUnique({ where: { id: classId } });
  if (!klass || klass.archived) return res.status(400).json({ error: "Selected class is not valid" });

  const student = await prisma.student.update({ where: { id: studentId }, data: { classId } });
  await recordAudit({ actorUserId: req.user.id, action: "STUDENT_CLASS_ASSIGNED", targetType: "Student", targetId: studentId, metadata: { classId } });
  res.json({ student });
}
