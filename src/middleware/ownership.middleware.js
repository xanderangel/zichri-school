const prisma = require("../lib/prisma");

/**
 * A student may only ever act on their OWN Student record. This guard
 * loads the Student row for the requested :studentId param and rejects
 * unless it belongs to req.user. This is the concrete mechanism behind
 * "Students must only access their own records" — it is enforced here,
 * not just assumed at the UI layer.
 */
async function requireOwnStudentRecord(req, res, next) {
  try {
    const { studentId } = req.params;
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) return res.status(404).json({ error: "Student not found" });
    if (req.user.role === "STUDENT" && student.userId !== req.user.id) {
      return res.status(403).json({ error: "Cannot access another student's records" });
    }
    req.targetStudent = student;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * A teacher may only act on spreadsheets they own, and only while the
 * relevant version is unlocked (enforced separately at the write-path,
 * since admins are also allowed to VIEW locked spreadsheets).
 */
async function requireOwnSpreadsheet(req, res, next) {
  try {
    const { spreadsheetId } = req.params;
    const spreadsheet = await prisma.spreadsheet.findUnique({ where: { id: spreadsheetId } });
    if (!spreadsheet) return res.status(404).json({ error: "Spreadsheet not found" });

    if (req.user.role === "TEACHER") {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.id } });
      if (!teacher || spreadsheet.teacherId !== teacher.id) {
        return res.status(403).json({ error: "Cannot access another teacher's spreadsheet" });
      }
    }
    req.targetSpreadsheet = spreadsheet;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Same as requireOwnSpreadsheet but for routes keyed by :versionId — loads
 * the version's parent spreadsheet and checks ownership through it.
 */
async function requireOwnSpreadsheetVersion(req, res, next) {
  try {
    const { versionId } = req.params;
    const version = await prisma.spreadsheetVersion.findUnique({
      where: { id: versionId },
      include: { spreadsheet: true },
    });
    if (!version) return res.status(404).json({ error: "Spreadsheet version not found" });

    if (req.user.role === "TEACHER") {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.id } });
      if (!teacher || version.spreadsheet.teacherId !== teacher.id) {
        return res.status(403).json({ error: "Cannot access another teacher's spreadsheet" });
      }
    }
    req.targetVersion = version;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * A student may only ever view their OWN report cards. Loads the report
 * card, checks its studentId against req.user's Student record, and
 * returns 404 (not 403) on mismatch so a guessed ID can't even be
 * confirmed to exist — this is the concrete mechanism stopping "change
 * the ID in the URL" access to someone else's report.
 */
async function requireOwnReportCard(req, res, next) {
  try {
    const { reportCardId } = req.params;
    const reportCard = await prisma.reportCard.findUnique({ where: { id: reportCardId } });
    if (!reportCard) return res.status(404).json({ error: "Report card not found" });

    const student = await prisma.student.findUnique({ where: { userId: req.user.id } });
    if (!student || reportCard.studentId !== student.id) {
      return res.status(404).json({ error: "Report card not found" });
    }
    req.targetReportCard = reportCard;
    req.targetStudentRecord = student;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireOwnStudentRecord, requireOwnSpreadsheet, requireOwnSpreadsheetVersion, requireOwnReportCard };
