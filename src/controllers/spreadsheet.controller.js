const prisma = require("../lib/prisma");

/**
 * Lists spreadsheets that have at least one LOCKED version, newest first,
 * with a summary of their version history. Admin only ever sees LOCKED
 * data — DRAFT/SAVED versions are a teacher's private working copy and
 * are intentionally excluded here (spec: "Admin can see locked
 * spreadsheets submitted by teachers").
 */
async function listLockedSpreadsheets(req, res) {
  const { classId, sessionId, termId } = req.query;

  const where = {
    versions: { some: { status: "LOCKED" } },
  };
  if (classId) where.classId = classId;
  if (sessionId) where.sessionId = sessionId;
  if (termId) where.termId = termId;

  const spreadsheets = await prisma.spreadsheet.findMany({
    where,
    include: {
      class: true,
      session: true,
      term: true,
      teacher: { select: { fullName: true, id: true, user: { select: { accountStatus: true } } } },
      versions: {
        where: { status: "LOCKED" },
        orderBy: { versionNumber: "desc" },
        select: { id: true, versionNumber: true, lockedAt: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Shape into the card format the spec describes: [Class] Spreadsheet
  // [Session] + latest lock date/time + version label.
  const cards = spreadsheets.map((s) => {
    const latest = s.versions[0];
    return {
      spreadsheetId: s.id,
      title: `${s.class.name} Spreadsheet ${s.session.name}`,
      term: s.term.name,
      lockedAt: latest?.lockedAt || null,
      latestVersionNumber: latest?.versionNumber || null,
      versionLabel: latest ? `Version ${latest.versionNumber}` : null,
      totalLockedVersions: s.versions.length,
      teacher: { id: s.teacher.id, fullName: s.teacher.fullName, accountStatus: s.teacher.user.accountStatus },
    };
  });

  res.json({ spreadsheets: cards });
}

/** All locked versions for one spreadsheet, oldest to newest, for the version-history view. */
async function listSpreadsheetVersions(req, res) {
  const { spreadsheetId } = req.params;
  const versions = await prisma.spreadsheetVersion.findMany({
    where: { spreadsheetId, status: "LOCKED" },
    orderBy: { versionNumber: "asc" },
    select: { id: true, versionNumber: true, lockedAt: true, unlockedAt: true },
  });
  res.json({ versions });
}

/**
 * Full read-only detail of one locked version: students, subjects,
 * scores, grades, remarks. No mutation endpoints exist for admin on this
 * data at all — enforcing "admin cannot alter locked academic records"
 * by simply never exposing a write path, not just a permission check.
 */
async function getSpreadsheetVersionDetail(req, res) {
  const { versionId } = req.params;

  const version = await prisma.spreadsheetVersion.findUnique({
    where: { id: versionId },
    include: {
      spreadsheet: { include: { class: true, session: true, term: true, teacher: { select: { fullName: true } } } },
      students: { include: { student: { select: { id: true, firstName: true, lastName: true, profileImageId: true } } } },
      scores: { include: { subject: true } },
      psychomotor: true,
      attendance: true,
      teacherRemarks: true,
    },
  });
  if (!version) return res.status(404).json({ error: "Spreadsheet version not found" });
  if (version.status !== "LOCKED") {
    return res.status(403).json({ error: "Only locked versions can be viewed by admin" });
  }

  // Group everything per-student for easy row rendering on the frontend.
  const rows = version.students.map(({ student }) => ({
    student: { id: student.id, firstName: student.firstName, lastName: student.lastName, profileImageId: student.profileImageId },
    scores: version.scores.filter((s) => s.studentId === student.id),
    psychomotor: version.psychomotor.filter((p) => p.studentId === student.id),
    attendance: version.attendance.find((a) => a.studentId === student.id) || null,
    remark: version.teacherRemarks.find((r) => r.studentId === student.id)?.remark || null,
  }));

  res.json({
    spreadsheet: {
      id: version.spreadsheet.id,
      title: `${version.spreadsheet.class.name} Spreadsheet ${version.spreadsheet.session.name}`,
      term: version.spreadsheet.term.name,
      teacherName: version.spreadsheet.teacher.fullName,
    },
    version: { id: version.id, versionNumber: version.versionNumber, lockedAt: version.lockedAt, status: version.status },
    rows,
  });
}

module.exports = { listLockedSpreadsheets, listSpreadsheetVersions, getSpreadsheetVersionDetail, downloadBatchReportCards, getReportCardDetail };

/** Admin equivalent of the teacher's batch PDF — same underlying renderer, so the document is identical either way. */
async function downloadBatchReportCards(req, res) {
  const { versionId } = req.params;
  const version = await prisma.spreadsheetVersion.findUnique({ where: { id: versionId } });
  if (!version) return res.status(404).json({ error: "Spreadsheet version not found" });
  if (version.status !== "LOCKED") return res.status(400).json({ error: "Only a locked version can produce official report cards" });

  const { renderBatchReportCardsPdf } = require("../services/reportCard.service");
  const { recordAudit } = require("../services/audit.service");
  const settings = await prisma.schoolSettings.findUnique({ where: { id: "singleton" } });

  try {
    const pdfBuffer = await renderBatchReportCardsPdf(versionId, settings);
    await recordAudit({ actorUserId: req.user.id, action: "REPORT_CARDS_BATCH_DOWNLOADED", targetType: "SpreadsheetVersion", targetId: versionId });
    res.set("Content-Type", "application/pdf");
    res.send(pdfBuffer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/** Admin can view any report card's detail (read-only, for the print-preview page) — no ownership restriction beyond the admin role itself. */
async function getReportCardDetail(req, res) {
  const { reportCardId } = req.params;
  const { buildReportCardDetailView } = require("../services/reportCardDetail.service");
  const view = await buildReportCardDetailView(reportCardId);
  if (!view) return res.status(404).json({ error: "Report card not found" });
  res.json(view);
}
