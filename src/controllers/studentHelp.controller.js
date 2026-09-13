const { z } = require("zod");
const prisma = require("../lib/prisma");
const { sendMail } = require("../services/mailer.service");
const { recordAudit } = require("../services/audit.service");

const helpSchema = z.object({ message: z.string().min(1).max(2000) });

async function sendHelpMessage(req, res) {
  const parsed = helpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A message is required" });

  const settings = await prisma.schoolSettings.findUnique({ where: { id: "singleton" } });
  if (!settings?.administrativeEmail) {
    return res.status(400).json({ error: "The school hasn't configured an administrative email yet — please contact them directly." });
  }

  const student = await prisma.student.findUnique({ where: { userId: req.user.id } });
  const displayName = student?.firstName ? `${student.firstName} ${student.lastName}` : req.user.username;

  const result = await sendMail({
    to: settings.administrativeEmail,
    subject: `Help request from student — ${displayName}`,
    html: `<p>Message from <b>${displayName}</b> (${student?.email || req.user.username}):</p><p>${parsed.data.message.replace(/\n/g, "<br/>")}</p>`,
  });

  await recordAudit({
    actorUserId: req.user.id,
    action: "STUDENT_HELP_MESSAGE_SENT",
    targetType: "User",
    targetId: req.user.id,
    metadata: { delivered: result.delivered },
  });

  res.json({
    ok: true,
    delivered: result.delivered,
    message: result.delivered
      ? "Your message has been sent."
      : "Your message was recorded, but email delivery isn't configured yet — the school has been notified in the audit log.",
  });
}

module.exports = { sendHelpMessage };
