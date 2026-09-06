const express = require("express");
const ctrl = require("../controllers/admin.controller");
const teacherCtrl = require("../controllers/teacher.controller");
const studentCtrl = require("../controllers/student.controller");
const classCtrl = require("../controllers/class.controller");
const spreadsheetCtrl = require("../controllers/spreadsheet.controller");
const deliveryCtrl = require("../controllers/reportDelivery.controller");
const searchCtrl = require("../controllers/search.controller");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const { makeUploader } = require("../utils/upload");

const router = express.Router();
const logoUpload = makeUploader();

// Every route in this file is admin-only.
router.use(requireAuth, requireRole("ADMIN"));

// Dashboard summary / notifications
router.get("/dashboard-summary", ctrl.getDashboardSummary);

// Accounts
router.get("/accounts", ctrl.listAccounts);
router.patch("/accounts/:userId/status", ctrl.setAccountStatus);

// Teachers
router.get("/teachers", teacherCtrl.listTeachers);
router.get("/teachers/:teacherId", teacherCtrl.getTeacherProfile);

// Students
router.get("/students", studentCtrl.listStudents);
router.get("/students/:studentId", studentCtrl.getStudentProfile);
router.patch("/students/:studentId/class", studentCtrl.assignStudentClass);

// Classes
router.get("/classes", ctrl.listClasses);
router.post("/classes", ctrl.createClass);
router.get("/classes/:classId", classCtrl.getClassDetail);
router.patch("/classes/:classId", classCtrl.renameClass);
router.post("/classes/:classId/archive", classCtrl.archiveClass);
router.post("/classes/assign-teacher", ctrl.assignTeacherToClass);

// Sessions / Terms
router.post("/sessions", ctrl.createSession);
router.post("/terms", ctrl.createTerm);
router.get("/sessions", ctrl.listSessions);

// Subjects
router.get("/subjects", ctrl.listSubjects);
router.post("/subjects", ctrl.createSubject);

// Spreadsheets (read-only for admin)
router.get("/spreadsheets", spreadsheetCtrl.listLockedSpreadsheets);
router.get("/spreadsheets/:spreadsheetId/versions", spreadsheetCtrl.listSpreadsheetVersions);
router.get("/spreadsheet-versions/:versionId", spreadsheetCtrl.getSpreadsheetVersionDetail);
router.get("/spreadsheet-versions/:versionId/report-cards/pdf", spreadsheetCtrl.downloadBatchReportCards);
router.get("/report-cards/:reportCardId", spreadsheetCtrl.getReportCardDetail);

// Report card sending
router.post("/spreadsheet-versions/:versionId/send-report-cards", deliveryCtrl.sendReportCards);
router.get("/spreadsheet-versions/:versionId/delivery-status", deliveryCtrl.getDeliveryStatus);

// Search
router.get("/search", searchCtrl.search);

// School settings
router.get("/school-settings", ctrl.getSchoolSettings);
router.patch("/school-settings", ctrl.updateSchoolSettings);
router.post("/school-settings/logo", logoUpload.single("logo"), async (req, res) => {
  const prisma = require("../lib/prisma");
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const existingSettings = await prisma.schoolSettings.findUnique({ where: { id: "singleton" } });
  const oldLogoFileId = existingSettings?.logoFileId; // capture before it's replaced below

  const fileRow = await prisma.uploadedFile.create({
    data: {
      ownerUserId: req.user.id,
      purpose: "SCHOOL_LOGO",
      data: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    },
  });
  await prisma.schoolSettings.upsert({
    where: { id: "singleton" },
    update: { logoFileId: fileRow.id },
    create: { id: "singleton", logoFileId: fileRow.id },
  });

  // Clean up the logo this one replaced — same reasoning as profile pictures.
  if (oldLogoFileId) {
    await prisma.uploadedFile.delete({ where: { id: oldLogoFileId } }).catch(() => {});
  }

  res.json({ file: fileRow });
});

// Report card PDF download — authenticated stream from the database
// (PDF bytes live in UploadedFile.data, same as profile images — see
// server.js for why local-disk storage doesn't survive on most free
// hosts), not static hosting, since these documents contain a student's
// academic + personal data.
router.get("/report-cards/:reportCardId/pdf", async (req, res) => {
  const prisma = require("../lib/prisma");

  const reportCard = await prisma.reportCard.findUnique({
    where: { id: req.params.reportCardId },
    include: { pdfFile: true },
  });
  if (!reportCard || !reportCard.pdfFile) return res.status(404).json({ error: "Report card PDF not found" });

  res.set("Content-Type", "application/pdf");
  res.send(reportCard.pdfFile.data);
});

// Audit log
router.get("/audit-logs", ctrl.listAuditLogs);

module.exports = router;
