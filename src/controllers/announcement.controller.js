const { z } = require("zod");
const prisma = require("../lib/prisma");
const { recordAudit } = require("../services/audit.service");
const { cleanupExpiredAnnouncements } = require("../services/announcementCleanup.service");
const { sendMail } = require("../services/mailer.service");

/**
 * One-way announcements. An Admin can target any combination of classes
 * (or everyone); a Teacher can only ever target the students in their
 * own class — never other teachers, never another class — enforced here
 * server-side, not just hidden in the UI. Either way, the actual
 * recipient list is computed once and stored (AnnouncementRecipient),
 * which is what makes "seen by 12 of 15" possible and keeps a sent
 * message's audience historically accurate even if someone later
 * changes class.
 */
const createSchema = z.object({
  message: z.string().min(1).max(4000),
  classIds: z.array(z.string()).optional(),
  sendToAll: z.boolean().optional(),
});

async function createAnnouncement(req, res) {
  const parsed = createSchema.safeParse({
    message: req.body.message,
    classIds: req.body.classIds ? JSON.parse(req.body.classIds) : undefined,
    sendToAll: req.body.sendToAll === "true" || req.body.sendToAll === true,
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const { message, classIds, sendToAll } = parsed.data;

  let targetClassIds = [];
  let authorLabel;
  let recipientScope; // "TEACHERS_AND_STUDENTS" or "STUDENTS_ONLY"

  if (req.user.role === "ADMIN") {
    if (sendToAll) {
      const allClasses = await prisma.class.findMany({ where: { archived: false }, select: { id: true } });
      targetClassIds = allClasses.map((c) => c.id);
      if (!targetClassIds.length) return res.status(400).json({ error: "No classes exist yet to send to." });
    } else {
      if (!classIds || !classIds.length) return res.status(400).json({ error: "Select at least one class, or choose Send to All." });
      targetClassIds = classIds;
    }
    authorLabel = "School Administration";
    recipientScope = "TEACHERS_AND_STUDENTS";
  } else if (req.user.role === "TEACHER") {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: req.user.id },
      include: { classAssignments: { where: { removedAt: null, isPrimary: true }, include: { class: true }, take: 1 } },
    });
    const assignment = teacher?.classAssignments[0];
    if (!teacher || !assignment) return res.status(400).json({ error: "You have no assigned class yet — contact the admin." });
    targetClassIds = [assignment.classId];
    authorLabel = `${teacher.fullName} (${assignment.class.name})`;
    recipientScope = "STUDENTS_ONLY"; // a teacher's message never reaches other teachers, even the class's own — one-way to students only
  } else {
    return res.status(403).json({ error: "Only Admin or Teacher accounts can send announcements." });
  }

  // Compute the actual recipient set now, once.
  const recipientUserIds = new Set();
  if (recipientScope === "TEACHERS_AND_STUDENTS") {
    const teacherAssignments = await prisma.classAssignment.findMany({
      where: { classId: { in: targetClassIds }, removedAt: null },
      include: { teacher: { select: { userId: true } } },
    });
    teacherAssignments.forEach((a) => recipientUserIds.add(a.teacher.userId));
  }
  const students = await prisma.student.findMany({
    where: { classId: { in: targetClassIds }, user: { accountStatus: "VERIFIED" } },
    select: { userId: true },
  });
  students.forEach((s) => recipientUserIds.add(s.userId));

  if (!recipientUserIds.size) return res.status(400).json({ error: "No verified recipients found for the selected class(es)." });

  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 3);

  const files = req.files || [];

  const announcement = await prisma.$transaction(async (tx) => {
    const ann = await tx.announcement.create({
      data: { authorUserId: req.user.id, authorRole: req.user.role, authorLabel, message, sentToAll: !!sendToAll, expiresAt },
    });
    await tx.announcementClass.createMany({ data: targetClassIds.map((classId) => ({ announcementId: ann.id, classId })) });
    for (const file of files) {
      const fileRow = await tx.uploadedFile.create({
        data: { ownerUserId: req.user.id, purpose: "ANNOUNCEMENT_ATTACHMENT", data: file.buffer, originalName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size },
      });
      await tx.announcementAttachment.create({ data: { announcementId: ann.id, fileId: fileRow.id } });
    }
    await tx.announcementRecipient.createMany({ data: [...recipientUserIds].map((userId) => ({ announcementId: ann.id, userId })) });
    return ann;
  });

  await recordAudit({
    actorUserId: req.user.id,
    action: "ANNOUNCEMENT_SENT",
    targetType: "Announcement",
    targetId: announcement.id,
    metadata: { recipientCount: recipientUserIds.size, classes: targetClassIds.length, sentToAll: !!sendToAll },
  });

  // Best-effort email "you have a new message" ping — fire-and-forget so
  // the request doesn't wait on potentially dozens of paced sends. The
  // real message is already safely sitting in each recipient's in-app
  // mailbox regardless of whether this email succeeds, gets delayed by
  // a daily sending cap, or fails outright.
  notifyRecipientsByEmail(announcement.id, [...recipientUserIds]).catch(() => {});

  res.status(201).json({ ok: true, announcementId: announcement.id, recipientCount: recipientUserIds.size });
}

async function notifyRecipientsByEmail(announcementId, userIds) {
  const announcement = await prisma.announcement.findUnique({ where: { id: announcementId } });
  if (!announcement) return;
  const preview = announcement.message.length > 200 ? announcement.message.slice(0, 200) + "…" : announcement.message;

  for (const userId of userIds) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { teacher: true, student: true } });
    const email = user?.teacher?.email || user?.student?.email;
    if (!email) continue;
    await sendMail({
      to: email,
      subject: `New message from ${announcement.authorLabel}`,
      html: `<p>You have a new message in your Zichri School mailbox from <b>${announcement.authorLabel}</b>:</p><p>${preview}</p><p>Open the app to read the full message${announcement.sentToAll ? "" : ""}.</p>`,
    });
    // Gentle pacing between sends — avoids bursting the whole class at
    // once and stays well clear of any provider-side rate limiting.
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

/** What this account has sent, newest first, with read-progress summary. */
async function listSentAnnouncements(req, res) {
  await cleanupExpiredAnnouncements();
  const announcements = await prisma.announcement.findMany({
    where: { authorUserId: req.user.id },
    include: { recipients: true, targetClasses: { include: { class: true } }, attachments: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({
    announcements: announcements.map((a) => ({
      id: a.id,
      message: a.message,
      createdAt: a.createdAt,
      expiresAt: a.expiresAt,
      classes: a.targetClasses.map((tc) => tc.class.name),
      sentToAll: a.sentToAll,
      attachmentCount: a.attachments.length,
      totalRecipients: a.recipients.length,
      readCount: a.recipients.filter((r) => r.readAt).length,
    })),
  });
}

/** Full detail of one sent message, including exactly who has read it. */
async function getSentAnnouncementDetail(req, res) {
  const ann = await prisma.announcement.findUnique({
    where: { id: req.params.id },
    include: {
      recipients: { include: { user: { include: { teacher: true, student: true } } } },
      attachments: { include: { file: true } },
      targetClasses: { include: { class: true } },
    },
  });
  if (!ann || ann.authorUserId !== req.user.id) return res.status(404).json({ error: "Not found" });

  res.json({
    id: ann.id,
    message: ann.message,
    createdAt: ann.createdAt,
    expiresAt: ann.expiresAt,
    classes: ann.targetClasses.map((tc) => tc.class.name),
    sentToAll: ann.sentToAll,
    attachments: ann.attachments.map((a) => ({ id: a.id, name: a.file.originalName, sizeBytes: a.file.sizeBytes })),
    recipients: ann.recipients
      .map((r) => ({
        name: r.user.teacher?.fullName || (r.user.student ? `${r.user.student.firstName || ""} ${r.user.student.lastName || ""}`.trim() : r.user.username),
        role: r.user.role,
        read: !!r.readAt,
        readAt: r.readAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}

module.exports = { createAnnouncement, listSentAnnouncements, getSentAnnouncementDetail };
