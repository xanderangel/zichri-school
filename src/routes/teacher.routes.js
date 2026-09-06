const express = require("express");
const ctrl = require("../controllers/teacherSpreadsheet.controller");
const profileCtrl = require("../controllers/teacherProfile.controller");
const { requireAuth, requireRole, requireVerified } = require("../middleware/auth.middleware");
const { requireOwnSpreadsheet, requireOwnSpreadsheetVersion } = require("../middleware/ownership.middleware");
const { makeUploader } = require("../utils/upload");

const router = express.Router();
const photoUpload = makeUploader();

// Every route here requires a logged-in, VERIFIED teacher — a PENDING
// teacher account can still hit /me (to see its own status) but nothing
// else, matching "only VERIFIED accounts can access main functionality."
router.use(requireAuth, requireRole("TEACHER"));

router.get("/me", profileCtrl.getMyProfile);
router.post("/me/photo", requireVerified, photoUpload.single("photo"), profileCtrl.setProfilePicture);

router.use(requireVerified);

// Wizard lookup data
router.get("/create-options", ctrl.getCreateOptions);
router.post("/subjects", ctrl.createSubject);

// Spreadsheets
router.get("/spreadsheets", ctrl.listMySpreadsheets);
router.post("/spreadsheets", ctrl.createSpreadsheet);
router.get("/spreadsheets/:spreadsheetId", requireOwnSpreadsheet, ctrl.getSpreadsheetDetail);

// Versions
router.get("/spreadsheet-versions/:versionId", requireOwnSpreadsheetVersion, ctrl.getVersionDetail);
router.patch("/spreadsheet-versions/:versionId/autosave", requireOwnSpreadsheetVersion, ctrl.autosave);
router.post("/spreadsheet-versions/:versionId/lock", requireOwnSpreadsheetVersion, ctrl.lockVersion);
router.post("/spreadsheet-versions/:versionId/unlock", requireOwnSpreadsheetVersion, ctrl.unlockVersion);
router.get("/spreadsheet-versions/:versionId/print", requireOwnSpreadsheetVersion, ctrl.printSpreadsheet);
router.post("/spreadsheet-versions/:versionId/generate-report-cards", requireOwnSpreadsheetVersion, ctrl.generateReportCards);
router.get("/spreadsheet-versions/:versionId/report-cards/pdf", requireOwnSpreadsheetVersion, ctrl.downloadBatchReportCards);
router.get("/report-cards/:reportCardId", ctrl.getReportCardDetail);
router.get("/spreadsheet-versions/:versionId/students/:studentId/ai-remark", requireOwnSpreadsheetVersion, ctrl.suggestRemark);

// Report card PDF download — ownership isn't checked via requireOwnSpreadsheetVersion
// here (no versionId in the URL), so we verify directly that the report
// card's version belongs to this teacher before streaming the file.
// PDF bytes are read straight from the database (see server.js for why
// local-disk storage doesn't survive on most free hosts).
router.get("/report-cards/:reportCardId/pdf", async (req, res) => {
  const prisma = require("../lib/prisma");
  const reportCard = await prisma.reportCard.findUnique({
    where: { id: req.params.reportCardId },
    include: { pdfFile: true, spreadsheetVersion: { include: { spreadsheet: true } } },
  });
  if (!reportCard || !reportCard.pdfFile) return res.status(404).json({ error: "Report card PDF not found" });

  const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.id } });
  if (!teacher || reportCard.spreadsheetVersion.spreadsheet.teacherId !== teacher.id) {
    return res.status(403).json({ error: "Not your spreadsheet" });
  }

  res.set("Content-Type", "application/pdf");
  res.send(reportCard.pdfFile.data);
});

module.exports = router;
