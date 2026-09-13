const prisma = require("../lib/prisma");

/**
 * Permanently deletes any announcement (and, via cascade, its
 * attachments and recipient records) past its 3-month expiry. This is
 * deliberately real deletion, not archiving — per school policy, nothing
 * should linger past 3 months, including the attachment file bytes
 * themselves (which is why the UploadedFile rows are deleted here too,
 * not just the Announcement).
 *
 * Called lazily at the top of every announcement/mailbox read — cheap
 * (an indexed date comparison), and means cleanup happens the moment
 * anyone next opens the app rather than requiring a separate scheduled
 * job. Combined with every read query also filtering out anything past
 * expiresAt, an expired message is never visible even in the brief
 * window before this cleanup next runs.
 */
async function cleanupExpiredAnnouncements() {
  const expired = await prisma.announcement.findMany({
    where: { expiresAt: { lt: new Date() } },
    select: { id: true, attachments: { select: { fileId: true } } },
  });
  if (!expired.length) return;

  const fileIds = expired.flatMap((a) => a.attachments.map((att) => att.fileId));

  await prisma.$transaction([
    prisma.announcement.deleteMany({ where: { id: { in: expired.map((a) => a.id) } } }), // cascades to AnnouncementClass/Attachment/Recipient
    ...(fileIds.length ? [prisma.uploadedFile.deleteMany({ where: { id: { in: fileIds } } })] : []),
  ]);
}

module.exports = { cleanupExpiredAnnouncements };
