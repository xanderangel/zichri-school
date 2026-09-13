/**
 * Sends transactional email via Brevo's HTTPS API rather than raw SMTP.
 * This isn't a style choice — Render's free tier blocks all outbound
 * traffic to SMTP ports (25, 465, 587) as an anti-spam measure, so SMTP
 * (including Gmail's) cannot work there at all, no matter how correctly
 * it's configured. Brevo's API sends over ordinary HTTPS (port 443),
 * which isn't blocked, and has a genuinely free tier (300 emails/day,
 * no credit card) — see https://www.brevo.com. Needs two environment
 * variables: BREVO_API_KEY and BREVO_SENDER_EMAIL (the sender address
 * verified in your Brevo account).
 */
async function sendMail({ to, subject, html, attachments }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;

  if (!apiKey || !senderEmail) {
    console.log(`[mailer] Email sending not configured — would have sent to ${to}: "${subject}"`);
    return { delivered: false, reason: "EMAIL_NOT_CONFIGURED" };
  }

  const body = {
    sender: { name: process.env.BREVO_SENDER_NAME || "Zichri School", email: senderEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };
  if (attachments && attachments.length) {
    body.attachment = attachments.map((a) => ({
      name: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content.toString("base64") : a.content,
    }));
  }

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[mailer] Brevo send failed", res.status, errText);
      return { delivered: false, reason: `Email service error (${res.status})` };
    }
    return { delivered: true };
  } catch (err) {
    console.error("[mailer] send failed", err);
    return { delivered: false, reason: err.message };
  }
}

module.exports = { sendMail };
