const { z } = require("zod");
const prisma = require("../lib/prisma");
const { getOrCreateReportCard, renderReportCardPdf } = require("../services/reportCard.service");
const { sendMail } = require("../services/mailer.service");
const { recordAudit } = require("../services/audit.service");

const sendSchema = z.object({
  studentIds: z.array(z.string()).min(1),
  confirm: z.literal(true), // requires explicit confirmation flag from the client's confirm dialog
});

/**
 * Sends locked report cards to the selected students only. For each
 * student: generates/reuses the ReportCard + PDF, marks it issued
 * (immutable dashboard delivery), emails a copy to the student if email sending
 * is configured, and BCCs/copies the school's administrative email.
 * Every attempt — success or failure — gets a ReportCardDeliveryRecord
 * row so the admin can see Pending/Sent/Failed per student per channel.
 */
async function sendReportCards(req, res) {
  const { versionId } = req.params;
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "studentIds (non-empty) and confirm:true are required" });
  }
  const { studentIds } = parsed.data;

  const version = await prisma.spreadsheetVersion.findUnique({
    where: { id: versionId },
    include: { spreadsheet: true },
  });
  if (!version) return res.status(404).json({ error: "Spreadsheet version not found" });
  if (version.status !== "LOCKED") {
    return res.status(400).json({ error: "Only locked versions can be sent" });
  }

  // Reject any requested student who isn't actually part of this version —
  // prevents sending a report card for data that doesn't exist here.
  const membership = await prisma.spreadsheetStudent.findMany({
    where: { spreadsheetVersionId: versionId, studentId: { in: studentIds } },
  });
  const validIds = new Set(membership.map((m) => m.studentId));
  const invalid = studentIds.filter((id) => !validIds.has(id));
  if (invalid.length) {
    return res.status(400).json({ error: "Some selected students are not part of this spreadsheet", invalid });
  }

  const settings = await prisma.schoolSettings.findUnique({ where: { id: "singleton" } });

  const results = [];
  for (const studentId of studentIds) {
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    const reportCard = await getOrCreateReportCard(studentId, versionId);
    const pdfFile = await renderReportCardPdf(reportCard.id, settings);

    if (!reportCard.issuedAt) {
      await prisma.reportCard.update({
        where: { id: reportCard.id },
        data: { issuedAt: new Date(), isLocked: true },
      });
    }

    // Dashboard delivery: the record's existence + issuedAt is what makes
    // it visible on the student's dashboard in a later phase — always
    // counts as delivered once generated.
    await prisma.reportCardDeliveryRecord.create({
      data: { reportCardId: reportCard.id, channel: "DASHBOARD", status: "SENT", deliveredAt: new Date() },
    });

    // PDF bytes live in the database now (pdfFile.data) — Brevo's API
    // accepts attachment content as base64, handled inside sendMail().
    const pdfContent = pdfFile.data;

    // Student email copy. If email sending isn't configured at all, this isn't a
    // genuine failure — nothing was actually attempted — so it's
    // recorded as PENDING rather than FAILED. Counting "email isn't set
    // up yet" as a failure meant the admin's notification badge grew by
    // one on every single send and never had any way to go back down,
    // since nothing ever un-fails a permanent non-attempt. A real
    // failure (email configured but something genuinely went wrong —
    // bad credentials, quota exceeded, etc.) still correctly shows FAILED.
    let studentEmailStatus = "PENDING";
    if (student.email) {
      const result = await sendMail({
        to: student.email,
        subject: `Your Report Card — ${reportCard.snapshotTermName}, ${reportCard.snapshotSessionName}`,
        html: `<p>Dear ${reportCard.snapshotFirstName},</p><p>Your report card for ${reportCard.snapshotTermName} (${reportCard.snapshotSessionName}) is attached.</p>`,
        attachments: [{ filename: "report-card.pdf", content: pdfContent }],
      });
      studentEmailStatus = result.delivered ? "SENT" : result.reason === "EMAIL_NOT_CONFIGURED" ? "PENDING" : "FAILED";
      await prisma.reportCardDeliveryRecord.create({
        data: {
          reportCardId: reportCard.id,
          channel: "EMAIL",
          status: studentEmailStatus,
          deliveredAt: result.delivered ? new Date() : null,
          failureReason: result.reason || null,
        },
      });
    }

    // Administrative copy
    if (settings?.administrativeEmail) {
      await sendMail({
        to: settings.administrativeEmail,
        subject: `[Admin Copy] Report Card — ${reportCard.snapshotFirstName} ${reportCard.snapshotLastName}`,
        html: `<p>Administrative copy of report card for ${reportCard.snapshotFirstName} ${reportCard.snapshotLastName}, ${reportCard.snapshotClassName}.</p>`,
        attachments: [{ filename: "report-card.pdf", content: pdfContent }],
      });
    }

    results.push({ studentId, reportCardId: reportCard.id, emailStatus: studentEmailStatus });

    await recordAudit({
      actorUserId: req.user.id,
      action: "REPORT_CARD_SENT",
      targetType: "ReportCard",
      targetId: reportCard.id,
      metadata: { studentId, spreadsheetVersionId: versionId },
    });
  }

  res.json({ ok: true, results });
}

/** Delivery status for every student on a version — backs the Pending/Sent/Failed display. */
async function getDeliveryStatus(req, res) {
  const { versionId } = req.params;
  const reportCards = await prisma.reportCard.findMany({
    where: { spreadsheetVersionId: versionId },
    include: { deliveryRecords: true, student: { select: { firstName: true, lastName: true } } },
  });
  res.json({
    reportCards: reportCards.map((rc) => ({
      reportCardId: rc.id,
      studentId: rc.studentId,
      studentName: `${rc.student.firstName} ${rc.student.lastName}`,
      issuedAt: rc.issuedAt,
      deliveries: rc.deliveryRecords.map((d) => ({ channel: d.channel, status: d.status, deliveredAt: d.deliveredAt })),
    })),
  });
}

module.exports = { sendReportCards, getDeliveryStatus };
