const prisma = require("../lib/prisma");
const { buildVersionView } = require("../services/spreadsheetView.service");
const { buildReportCardDetailView } = require("../services/reportCardDetail.service");

/**
 * Only report cards with issuedAt set are shown — a ReportCard row can
 * exist (created by getOrCreateReportCard) without ever having been sent,
 * and an unsent one must never be visible to the student it's about.
 * issuedAt is what "delivered to the student's dashboard" actually means
 * (see reportDelivery.controller.js in phase 2).
 */
async function listMyReportCards(req, res) {
  const student = await prisma.student.findUnique({ where: { userId: req.user.id } });
  if (!student) return res.status(404).json({ error: "Student profile not found" });

  const reportCards = await prisma.reportCard.findMany({
    where: { studentId: student.id, issuedAt: { not: null } },
    orderBy: { issuedAt: "desc" },
  });

  const results = [];
  for (const rc of reportCards) {
    const view = await buildVersionView(rc.spreadsheetVersionId);
    const row = view?.rows.find((r) => r.student.id === student.id);
    results.push({
      id: rc.id,
      sessionName: rc.snapshotSessionName,
      termName: rc.snapshotTermName,
      className: rc.snapshotClassName,
      issuedAt: rc.issuedAt,
      percentage: row?.overall.percentage ?? null,
      finalGrade: row?.overall.finalGrade ?? null,
    });
  }

  res.json({ reportCards: results });
}

/** req.targetReportCard is already loaded and ownership-checked by requireOwnReportCard. */
async function getMyReportCardDetail(req, res) {
  const view = await buildReportCardDetailView(req.targetReportCard.id);
  if (!view) return res.status(404).json({ error: "Report card data not found" });
  res.json(view);
}

module.exports = { listMyReportCards, getMyReportCardDetail };
