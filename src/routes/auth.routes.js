const express = require("express");
const rateLimit = require("express-rate-limit");
const ctrl = require("../controllers/auth.controller");
const { requireAuth } = require("../middleware/auth.middleware");

const router = express.Router();

// Throttle login attempts per-IP on top of the per-account lockout in the
// controller — two independent layers against brute force.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post("/login", loginLimiter, ctrl.login);
router.post("/refresh", ctrl.refresh);
router.post("/logout", ctrl.logout);
router.post("/change-password", requireAuth, ctrl.changePassword);
router.post("/forgot-password", loginLimiter, ctrl.forgotPassword);
router.post("/reset-password", loginLimiter, ctrl.resetPassword);

// Admin forced first-login flow
router.post("/admin/security-setup", requireAuth, ctrl.submitAdminSecuritySetup);
router.get("/admin/verify-recovery-email/:token", ctrl.verifyRecoveryEmail);

module.exports = router;
