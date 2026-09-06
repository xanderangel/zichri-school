const express = require("express");
const profileCtrl = require("../controllers/studentProfile.controller");
const reportCardCtrl = require("../controllers/studentReportCard.controller");
const helpCtrl = require("../controllers/studentHelp.controller");
const { requireAuth, requireRole, requireVerified } = require("../middleware/auth.middleware");
const { requireOwnReportCard } = require("../middleware/ownership.middleware");
const { makeUploader } = require("../utils/upload");

const router = express.Router();
const photoUpload = makeUploader();

// A PENDING student can still hit /me to see their own status; everything
// else requires VERIFIED, same pattern as the teacher routes.
router.use(requireAuth, requireRole("STUDENT"));

router.get("/me", profileCtrl.getMyProfile);

router.use(requireVerified);

// First-login setup wizard
router.patch("/profile", profileCtrl.updateMyProfile);
router.post("/profile/photo", photoUpload.single("photo"), profileCtrl.setProfilePicture);

// Report cards — strictly own-records-only, enforced by requireOwnReportCard
router.get("/report-cards", reportCardCtrl.listMyReportCards);
router.get("/report-cards/:reportCardId", requireOwnReportCard, reportCardCtrl.getMyReportCardDetail);
router.get("/report-cards/:reportCardId/pdf", requireOwnReportCard, (req, res) => {
  const prisma = require("../lib/prisma");
  prisma.reportCard.findUnique({ where: { id: req.targetReportCard.id }, include: { pdfFile: true } }).then((rc) => {
    if (!rc?.pdfFile) return res.status(404).json({ error: "PDF not available" });
    res.set("Content-Type", "application/pdf");
    res.send(rc.pdfFile.data);
  });
});

// Help / contact admin
router.post("/help", helpCtrl.sendHelpMessage);

module.exports = router;
