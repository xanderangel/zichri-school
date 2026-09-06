const { verifyAccessToken } = require("../lib/jwt");
const prisma = require("../lib/prisma");

/**
 * Verifies the access token, loads the current user fresh from the DB
 * (not just trusting the JWT payload) and attaches it as req.user.
 * Loading fresh matters because accountStatus can change (e.g. REMOVED)
 * after a token was issued — a stale JWT should not keep working.
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (user.accountStatus === "REMOVED") {
      return res.status(403).json({ error: "Account has been removed" });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Restricts a route to one or more roles. Use after requireAuth. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

/**
 * For TEACHER/STUDENT routes: blocks access unless the account is VERIFIED.
 * PENDING/REJECTED accounts can still log in (to see their status) but
 * cannot use main functionality, per spec.
 */
function requireVerified(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.user.role !== "ADMIN" && req.user.accountStatus !== "VERIFIED") {
    return res.status(403).json({ error: "Account not verified yet" });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireVerified };
