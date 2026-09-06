const prisma = require("../lib/prisma");
const grading = require("../lib/grading");

/**
 * Builds the read model for one spreadsheet version: per-student rows
 * with computed totals/grades, ready for the teacher's editor, the
 * lock/print path, and every report-card view (student/teacher/admin).
 *
 * This lives in its own file (not inside teacherSpreadsheet.controller.js)
 * specifically so the report-card services can import it without creating
 * a circular require — reportCard.service.js needs this, and
 * teacherSpreadsheet.controller.js needs reportCard.service.js, so this
 * function can't live in either of those two files.
 */
async function buildVersionView(versionId) {
  const version = await prisma.spreadsheetVersion.findUnique({
    where: { id: versionId },
    include: {
      spreadsheet: { include: { class: true, session: true, term: true } },
      students: { include: { student: { select: { id: true, firstName: true, lastName: true, profileImageId: true } } } },
      selectedSubjects: { include: { subject: true }, orderBy: { subject: { name: "asc" } } },
      scores: true,
      psychomotor: true,
      attendance: true,
      teacherRemarks: true,
    },
  });
  if (!version) return null;

  const subjects = version.selectedSubjects.map((s) => s.subject);

  const rows = version.students.map(({ student }) => {
    const scoresBySubject = {};
    const subjectTotals = [];
    for (const subject of subjects) {
      const row = version.scores.find((s) => s.studentId === student.id && s.subjectId === subject.id);
      scoresBySubject[subject.id] = row
        ? { testScore: row.caScore, examScore: row.examScore, totalScore: row.totalScore, grade: row.grade }
        : { testScore: null, examScore: null, totalScore: null, grade: null };
      subjectTotals.push(scoresBySubject[subject.id].totalScore || 0);
    }
    const overall = grading.computeOverallSummary(subjectTotals, subjects.length);
    const psychomotor = version.psychomotor.filter((p) => p.studentId === student.id);
    const attendance = version.attendance.find((a) => a.studentId === student.id) || null;
    const remark = version.teacherRemarks.find((r) => r.studentId === student.id)?.remark || "";

    return {
      student,
      scores: scoresBySubject,
      overall,
      psychomotor,
      attendance,
      remark,
    };
  });

  return {
    version: { id: version.id, versionNumber: version.versionNumber, status: version.status, lockedAt: version.lockedAt, updatedAt: version.updatedAt },
    spreadsheet: {
      id: version.spreadsheet.id,
      title: `${version.spreadsheet.class.name} Spreadsheet ${version.spreadsheet.session.name}`,
      className: version.spreadsheet.class.name,
      sessionName: version.spreadsheet.session.name,
      termName: version.spreadsheet.term.name,
    },
    subjects,
    rows,
  };
}

module.exports = { buildVersionView };
