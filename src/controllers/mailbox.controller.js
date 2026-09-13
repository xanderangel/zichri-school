const prisma = require("../lib/prisma");
const { cleanupExpiredAnnouncements } = require("../services/announcementCleanup.service");

/** This account's inbox, newest first. Expired messages are excluded by the query itself as well as actively cleaned up above. */
async function listMyMailbox(req, res) {
  await cleanupExpiredAnnouncements();
  const recipients = await prisma.announcementRecipient.findMany({
    where: { userId: req.user.id, announcement: { expiresAt: { gt: new Date() } } },
    include: { announcement: { include: { attachments: true } } },
    orderBy: { announcement: { createdAt: "desc" } },
  });
  res.json({
    messages: recipients.map((r) => ({
      id: r.announcement.id,
      message: r.announcement.message,
      authorLabel: r.announcement.authorLabel,
      createdAt: r.announcement.createdAt,
      expiresAt: r.announcement.expiresAt,
      attachmentCount: r.announcement.attachments.length,
      read: !!r.readAt,
    })),
  });
}

/** Opening a message marks it read — this single moment is what read-tracking on the sender's side reflects. */
async function getMailboxMessageDetail(req, res) {
  const recipient = await prisma.announcementRecipient.findUnique({
    where: { announcementId_userId: { announcementId: req.params.id, userId: req.user.id } },
    include: { announcement: { include: { attachments: { include: { file: true } } } } },
  });
  if (!recipient || recipient.announcement.expiresAt < new Date()) {
    return res.status(404).json({ error: "Message not found" });
  }
  if (!recipient.readAt) {
    await prisma.announcementRecipient.update({ where: { id: recipient.id }, data: { readAt: new Date() } });
  }
  res.json({
    id: recipient.announcement.id,
    message: recipient.announcement.message,
    authorLabel: recipient.announcement.authorLabel,
    createdAt: recipient.announcement.createdAt,
    expiresAt: recipient.announcement.expiresAt,
    attachments: recipient.announcement.attachments.map((a) => ({ id: a.id, name: a.file.originalName, sizeBytes: a.file.sizeBytes })),
  });
}

/** Only the message's actual recipients (or its author) can download an attachment — checked directly, not inferred from the UI. */
async function downloadAttachment(req, res) {
  const attachment = await prisma.announcementAttachment.findUnique({
    where: { id: req.params.attachmentId },
    include: { file: true, announcement: true },
  });
  if (!attachment) return res.status(404).json({ error: "Not found" });

  const isAuthor = attachment.announcement.authorUserId === req.user.id;
  if (!isAuthor) {
    const recipient = await prisma.announcementRecipient.findUnique({
      where: { announcementId_userId: { announcementId: attachment.announcementId, userId: req.user.id } },
    });
    if (!recipient) return res.status(403).json({ error: "Not authorized" });
  }

  res.set("Content-Type", attachment.file.mimeType);
  res.set("Content-Disposition", `attachment; filename="${attachment.file.originalName.replace(/"/g, "")}"`);
  res.send(attachment.file.data);
}

module.exports = { listMyMailbox, getMailboxMessageDetail, downloadAttachment };
