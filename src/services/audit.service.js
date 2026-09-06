const prisma = require("../lib/prisma");

/**
 * Record an audit event. Never throws into the caller's request flow —
 * a logging failure should not break the underlying operation, but it is
 * logged to the console so it isn't silently lost.
 */
async function recordAudit({ actorUserId, action, targetType, targetId, metadata, ipAddress }) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: actorUserId || null,
        action,
        targetType: targetType || null,
        targetId: targetId || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        ipAddress: ipAddress || null,
      },
    });
  } catch (err) {
    console.error("[audit] failed to record event", action, err);
  }
}

module.exports = { recordAudit };
