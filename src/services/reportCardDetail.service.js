const prisma = require("../lib/prisma");
const { buildVersionView } = require("./spreadsheetView.service");

/**
 * Builds the full display shape for one student's report card from its
 * LOCKED spreadsheet version. This is the one place that assembles
 * "everything a report card needs to show" — the student's own detail
 * endpoint, the teacher's and admin's read-only detail endpoints, and
 * the PDF renderer all call this same function, so the web view and the
 * printed document can never show different numbers.
 *
 * Historical integrity: every figure here comes from buildVersionView(),
 * which reads StudentSubjectScore/PsychomotorRating/Attendance rows tied
 * to this specific immutable spreadsheetVersionId — never recalculated
 * from the student's current live data. A report generated in 2026 stays
 * exactly what it was, no matter what changes afterward.
 */
async function buildReportCardDetailView(reportCardId) {
  const reportCard = await prisma.reportCard.findUnique({ where: { id: reportCardId } });
  if (!reportCard) return null;

  const student = await prisma.student.findUnique({ where: { id: reportCard.studentId } });
  const view = await buildVersionView(reportCard.spreadsheetVersionId);
  if (!view) return null;

  const row = view.rows.find((r) => r.student.id === reportCard.studentId);
  if (!row) return null;

  const age = student?.dateOfBirth
    ? Math.floor((Date.now() - new Date(student.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  return {
    reportCardId: reportCard.id,
    student: {
      firstName: reportCard.snapshotFirstName,
      lastName: reportCard.snapshotLastName,
      className: reportCard.snapshotClassName,
      sex: student?.sex || null,
      age,
      profileImageId: student?.profileImageId || null,
    },
    academic: {
      sessionName: reportCard.snapshotSessionName,
      termName: reportCard.snapshotTermName,
      issuedAt: reportCard.issuedAt,
    },
    attendance: row.attendance ? { timesSchoolOpened: row.attendance.timesSchoolOpened, timesPresent: row.attendance.timesPresent } : null,
    overall: row.overall,
    subjects: view.subjects.map((subj) => ({ name: subj.name, ...row.scores[subj.id] })),
    psychomotor: row.psychomotor,
    teacherComment: row.remark || "",
  };
}

module.exports = { buildReportCardDetailView };
