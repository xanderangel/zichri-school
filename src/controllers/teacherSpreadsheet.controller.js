const { z } = require("zod");
const prisma = require("../lib/prisma");
const grading = require("../lib/grading");
const { recordAudit } = require("../services/audit.service");
const { generateRemark } = require("../services/aiRemark.service");
const { renderSpreadsheetPdf } = require("../services/spreadsheetPdf.service");
const { getOrCreateReportCard, renderReportCardPdf, renderBatchReportCardsPdf } = require("../services/reportCard.service");
const { buildVersionView } = require("../services/spreadsheetView.service");

// --------------------------------------------------------------------------
// HELPERS
// --------------------------------------------------------------------------

async function getTeacherOrThrow(userId) {
  const teacher = await prisma.teacher.findUnique({
    where: { userId },
    include: { classAssignments: { where: { removedAt: null, isPrimary: true }, include: { class: true }, take: 1 } },
  });
  if (!teacher) throw Object.assign(new Error("Teacher profile not found"), { status: 404 });
  return teacher;
}

// --------------------------------------------------------------------------
// LOOKUP DATA FOR THE CREATE-SPREADSHEET WIZARD
// --------------------------------------------------------------------------

async function getCreateOptions(req, res) {
  const teacher = await getTeacherOrThrow(req.user.id);
  const klass = teacher.classAssignments[0]?.class || null;

  const [sessions, subjects, students] = await Promise.all([
    prisma.academicSession.findMany({ include: { terms: true }, orderBy: { name: "desc" } }),
    prisma.subject.findMany({ where: { archived: false }, orderBy: { name: "asc" } }),
    klass
      ? prisma.student.findMany({
          where: { classId: klass.id, user: { accountStatus: "VERIFIED" } },
          select: { id: true, firstName: true, lastName: true, profileImageId: true },
          orderBy: { firstName: "asc" },
        })
      : [],
  ]);

  res.json({ class: klass, sessions, subjects, students });
}

const subjectSchema = z.object({ name: z.string().min(1) });

async function createSubject(req, res) {
  const parsed = subjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Subject name is required" });
  const existing = await prisma.subject.findUnique({ where: { name: parsed.data.name } });
  if (existing) return res.json({ subject: existing }); // idempotent — teacher just gets the existing one
  const subject = await prisma.subject.create({ data: { name: parsed.data.name } });
  await recordAudit({ actorUserId: req.user.id, action: "SUBJECT_CREATED", targetType: "Subject", targetId: subject.id });
  res.status(201).json({ subject });
}

// --------------------------------------------------------------------------
// LIST / DASHBOARD
// --------------------------------------------------------------------------

async function listMySpreadsheets(req, res) {
  const teacher = await getTeacherOrThrow(req.user.id);
  const spreadsheets = await prisma.spreadsheet.findMany({
    where: { teacherId: teacher.id },
    include: {
      class: true,
      session: true,
      term: true,
      versions: { orderBy: { versionNumber: "desc" }, select: { id: true, versionNumber: true, status: true, lockedAt: true, updatedAt: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  res.json({
    spreadsheets: spreadsheets.map((s) => ({
      id: s.id,
      title: `${s.class.name} Spreadsheet ${s.session.name}`,
      term: s.term.name,
      currentVersionId: s.currentVersionId,
      latest: s.versions[0] || null,
      totalVersions: s.versions.length,
    })),
  });
}

// --------------------------------------------------------------------------
// CREATE
// --------------------------------------------------------------------------

const createSchema = z.object({
  sessionId: z.string().min(1),
  termId: z.string().min(1),
  studentIds: z.array(z.string()).min(1),
  subjectIds: z.array(z.string()).min(1),
});

async function createSpreadsheet(req, res) {
  const teacher = await getTeacherOrThrow(req.user.id);
  const klass = teacher.classAssignments[0]?.class;
  if (!klass) return res.status(400).json({ error: "You have no assigned class yet — contact the admin." });

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const { sessionId, termId, studentIds, subjectIds } = parsed.data;

  const existing = await prisma.spreadsheet.findUnique({
    where: { teacherId_classId_sessionId_termId: { teacherId: teacher.id, classId: klass.id, sessionId, termId } },
  });
  if (existing) {
    return res.status(409).json({ error: "A spreadsheet for this class/session/term already exists.", spreadsheetId: existing.id });
  }

  const result = await prisma.$transaction(async (tx) => {
    const spreadsheet = await tx.spreadsheet.create({
      data: { teacherId: teacher.id, classId: klass.id, sessionId, termId },
    });
    const version = await tx.spreadsheetVersion.create({
      data: { spreadsheetId: spreadsheet.id, versionNumber: 1, status: "DRAFT" },
    });
    await tx.spreadsheet.update({ where: { id: spreadsheet.id }, data: { currentVersionId: version.id } });
    await tx.spreadsheetStudent.createMany({
      data: studentIds.map((studentId) => ({ spreadsheetVersionId: version.id, studentId })),
    });
    await tx.spreadsheetVersionSubject.createMany({
      data: subjectIds.map((subjectId) => ({ spreadsheetVersionId: version.id, subjectId })),
    });
    return { spreadsheet, version };
  });

  await recordAudit({
    actorUserId: req.user.id,
    action: "SPREADSHEET_CREATED",
    targetType: "Spreadsheet",
    targetId: result.spreadsheet.id,
  });

  res.status(201).json({ spreadsheetId: result.spreadsheet.id, versionId: result.version.id });
}

// --------------------------------------------------------------------------
// DETAIL / VERSION HISTORY
// --------------------------------------------------------------------------

async function getSpreadsheetDetail(req, res) {
  const spreadsheet = req.targetSpreadsheet; // loaded + ownership-checked by middleware
  const view = await buildVersionView(spreadsheet.currentVersionId);
  const allVersions = await prisma.spreadsheetVersion.findMany({
    where: { spreadsheetId: spreadsheet.id },
    orderBy: { versionNumber: "asc" },
    select: { id: true, versionNumber: true, status: true, lockedAt: true },
  });
  res.json({ ...view, allVersions });
}

async function getVersionDetail(req, res) {
  const view = await buildVersionView(req.params.versionId);
  if (!view) return res.status(404).json({ error: "Version not found" });
  res.json(view);
}

// --------------------------------------------------------------------------
// AUTOSAVE (batch upsert — never creates a version, only writes into the
// current DRAFT/SAVED version's rows)
// --------------------------------------------------------------------------

const autosaveSchema = z.object({
  scores: z.array(z.object({
    studentId: z.string(),
    subjectId: z.string(),
    testScore: z.union([z.number(), z.null()]).optional(),
    examScore: z.union([z.number(), z.null()]).optional(),
  })).optional(),
  psychomotor: z.array(z.object({
    studentId: z.string(),
    trait: z.string(),
    rating: z.union([z.number().int().min(1).max(5), z.null()]),
  })).optional(),
  attendance: z.object({
    timesSchoolOpened: z.union([z.number(), z.null()]).optional(),
    perStudent: z.array(z.object({ studentId: z.string(), timesPresent: z.union([z.number(), z.null()]) })).optional(),
  }).optional(),
  remarks: z.array(z.object({ studentId: z.string(), remark: z.string() })).optional(),
});

async function autosave(req, res) {
  const version = req.targetVersion;
  if (version.status === "LOCKED") return res.status(403).json({ error: "This version is locked and read-only. Unlock it to make changes." });

  const parsed = autosaveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const { scores, psychomotor, attendance, remarks } = parsed.data;

  // --------------------------------------------------------------------
  // Validate the ENTIRE batch first, writing nothing yet. This autosave
  // call is a single atomic unit from the teacher's point of view — an
  // earlier version of this function validated row-by-row *while*
  // writing, so an invalid value partway through the batch (e.g.
  // lowering "School Opened" below one student's already-saved
  // "Present") would still let every other row commit, then report
  // "were not saved" even though most of it was. Validate-then-write
  // means the response is always literally true: either everything in
  // the batch is saved, or (on any error) nothing is.
  // --------------------------------------------------------------------
  const errors = [];

  for (const s of scores || []) {
    const test = grading.validateTestScore(s.testScore);
    const exam = grading.validateExamScore(s.examScore);
    if (!test.valid) errors.push({ type: "score", studentId: s.studentId, subjectId: s.subjectId, field: "testScore", reason: `Test score must be between 0 and ${grading.TEST_MAX}` });
    if (!exam.valid) errors.push({ type: "score", studentId: s.studentId, subjectId: s.subjectId, field: "examScore", reason: `Exam score must be between 0 and ${grading.EXAM_MAX}` });
  }

  // Attendance needs the *effective* state for every student on the
  // roster (existing DB value merged with whatever this call is
  // changing) validated as a whole, since "School Opened" applies to
  // everyone at once — changing it can invalidate another student's
  // already-saved "Present" even though that student's row isn't part
  // of this particular call's perStudent list.
  let attendanceWrites = [];
  if (attendance && (attendance.timesSchoolOpened !== undefined || attendance.perStudent)) {
    const opened = attendance.timesSchoolOpened;
    if (opened !== undefined && opened !== null && opened < 0) {
      errors.push({ type: "attendance", field: "timesSchoolOpened", reason: "School Opened cannot be negative" });
    } else {
      const allStudents = await prisma.spreadsheetStudent.findMany({ where: { spreadsheetVersionId: version.id } });
      const existingRows = await prisma.attendance.findMany({ where: { spreadsheetVersionId: version.id } });
      const existingByStudent = new Map(existingRows.map((r) => [r.studentId, r]));
      const presentMap = new Map((attendance.perStudent || []).map((p) => [p.studentId, p.timesPresent]));

      for (const { studentId } of allStudents) {
        const existingRow = existingByStudent.get(studentId);
        const present = presentMap.has(studentId) ? presentMap.get(studentId) : existingRow?.timesPresent ?? 0;
        const schoolOpened = opened !== undefined ? opened : existingRow?.timesSchoolOpened ?? 0;

        const check = grading.validateAttendance(schoolOpened, present);
        if (!check.valid) {
          errors.push({ type: "attendance", studentId, reason: check.reason });
          continue;
        }
        attendanceWrites.push({ studentId, schoolOpened, present });
      }
    }
  }

  if (errors.length) {
    return res.status(400).json({ error: "Some values were invalid — nothing in this save was applied. Please correct them and try again.", details: errors });
  }

  // Every value checked out — now actually write, all together.
  await prisma.$transaction(async (tx) => {
    // --- Scores ---
    for (const s of scores || []) {
      const test = grading.validateTestScore(s.testScore);
      const exam = grading.validateExamScore(s.examScore);
      const { totalScore, grade } = grading.computeSubjectResult(test.value, exam.value);

      if (test.value === null && exam.value === null) {
        await tx.studentSubjectScore.deleteMany({ where: { spreadsheetVersionId: version.id, studentId: s.studentId, subjectId: s.subjectId } });
        continue;
      }
      await tx.studentSubjectScore.upsert({
        where: { spreadsheetVersionId_studentId_subjectId: { spreadsheetVersionId: version.id, studentId: s.studentId, subjectId: s.subjectId } },
        update: { caScore: test.value, examScore: exam.value, totalScore, grade },
        create: { spreadsheetVersionId: version.id, studentId: s.studentId, subjectId: s.subjectId, caScore: test.value, examScore: exam.value, totalScore, grade },
      });
    }

    // --- Psychomotor (one rating per trait per student — upsert or delete) ---
    for (const p of psychomotor || []) {
      if (p.rating === null) {
        await tx.psychomotorRating.deleteMany({ where: { spreadsheetVersionId: version.id, studentId: p.studentId, trait: p.trait } });
        continue;
      }
      await tx.psychomotorRating.upsert({
        where: { spreadsheetVersionId_studentId_trait: { spreadsheetVersionId: version.id, studentId: p.studentId, trait: p.trait } },
        update: { rating: p.rating },
        create: { spreadsheetVersionId: version.id, studentId: p.studentId, trait: p.trait, rating: p.rating },
      });
    }

    // --- Attendance ---
    for (const { studentId, schoolOpened, present } of attendanceWrites) {
      await tx.attendance.upsert({
        where: { spreadsheetVersionId_studentId: { spreadsheetVersionId: version.id, studentId } },
        update: { timesSchoolOpened: schoolOpened, timesPresent: present },
        create: { spreadsheetVersionId: version.id, studentId, timesSchoolOpened: schoolOpened, timesPresent: present },
      });
    }

    // --- Teacher remarks ---
    for (const r of remarks || []) {
      await tx.teacherRemark.upsert({
        where: { spreadsheetVersionId_studentId: { spreadsheetVersionId: version.id, studentId: r.studentId } },
        update: { remark: r.remark },
        create: { spreadsheetVersionId: version.id, studentId: r.studentId, remark: r.remark },
      });
    }

    // Bump updatedAt so "Last saved at" reflects this write, and flip DRAFT -> SAVED.
    await tx.spreadsheetVersion.update({ where: { id: version.id }, data: { status: "SAVED", updatedAt: new Date() } });
  });

  const view = await buildVersionView(version.id);
  res.json({ ok: true, savedAt: view.version.updatedAt, view });
}

// --------------------------------------------------------------------------
// LOCK / UNLOCK
// --------------------------------------------------------------------------

async function lockVersion(req, res) {
  const version = req.targetVersion;
  if (version.status === "LOCKED") return res.status(400).json({ error: "Already locked" });

  const studentCount = await prisma.spreadsheetStudent.count({ where: { spreadsheetVersionId: version.id } });
  const subjectCount = await prisma.spreadsheetVersionSubject.count({ where: { spreadsheetVersionId: version.id } });
  if (!studentCount || !subjectCount) {
    return res.status(400).json({ error: "Add at least one student and one subject before locking" });
  }

  const locked = await prisma.spreadsheetVersion.update({
    where: { id: version.id },
    data: { status: "LOCKED", lockedAt: new Date(), lockedById: req.user.id },
  });

  await recordAudit({
    actorUserId: req.user.id,
    action: "SPREADSHEET_LOCKED",
    targetType: "SpreadsheetVersion",
    targetId: version.id,
    metadata: { versionNumber: version.versionNumber },
  });

  res.json({ ok: true, version: locked });
}

/**
 * Unlocking never mutates the locked version's data or status — it stamps
 * `unlockedAt` on the old version purely as a "this was superseded" marker,
 * then deep-copies every row into a brand-new DRAFT version one number
 * higher, and repoints the spreadsheet's currentVersionId at it. Only the
 * *current* (latest) locked version may be unlocked — older historical
 * versions are permanently frozen.
 */
async function unlockVersion(req, res) {
  const version = req.targetVersion;
  if (version.status !== "LOCKED") return res.status(400).json({ error: "Only a locked version can be unlocked" });
  if (version.spreadsheet.currentVersionId !== version.id) {
    return res.status(400).json({ error: "Only the latest version can be unlocked" });
  }

  const [students, scores, psychomotor, attendance, remarks, subjects] = await Promise.all([
    prisma.spreadsheetStudent.findMany({ where: { spreadsheetVersionId: version.id } }),
    prisma.studentSubjectScore.findMany({ where: { spreadsheetVersionId: version.id } }),
    prisma.psychomotorRating.findMany({ where: { spreadsheetVersionId: version.id } }),
    prisma.attendance.findMany({ where: { spreadsheetVersionId: version.id } }),
    prisma.teacherRemark.findMany({ where: { spreadsheetVersionId: version.id } }),
    prisma.spreadsheetVersionSubject.findMany({ where: { spreadsheetVersionId: version.id } }),
  ]);

  const newVersion = await prisma.$transaction(async (tx) => {
    const nv = await tx.spreadsheetVersion.create({
      data: { spreadsheetId: version.spreadsheetId, versionNumber: version.versionNumber + 1, status: "DRAFT" },
    });

    if (students.length) await tx.spreadsheetStudent.createMany({ data: students.map((s) => ({ spreadsheetVersionId: nv.id, studentId: s.studentId })) });
    if (subjects.length) await tx.spreadsheetVersionSubject.createMany({ data: subjects.map((s) => ({ spreadsheetVersionId: nv.id, subjectId: s.subjectId })) });
    if (scores.length) await tx.studentSubjectScore.createMany({ data: scores.map((s) => ({ spreadsheetVersionId: nv.id, studentId: s.studentId, subjectId: s.subjectId, caScore: s.caScore, examScore: s.examScore, totalScore: s.totalScore, grade: s.grade, remark: s.remark })) });
    if (psychomotor.length) await tx.psychomotorRating.createMany({ data: psychomotor.map((p) => ({ spreadsheetVersionId: nv.id, studentId: p.studentId, trait: p.trait, rating: p.rating })) });
    if (attendance.length) await tx.attendance.createMany({ data: attendance.map((a) => ({ spreadsheetVersionId: nv.id, studentId: a.studentId, timesPresent: a.timesPresent, timesAbsent: a.timesAbsent, timesSchoolOpened: a.timesSchoolOpened })) });
    if (remarks.length) await tx.teacherRemark.createMany({ data: remarks.map((r) => ({ spreadsheetVersionId: nv.id, studentId: r.studentId, remark: r.remark })) });

    await tx.spreadsheetVersion.update({ where: { id: version.id }, data: { unlockedAt: new Date() } });
    await tx.spreadsheet.update({ where: { id: version.spreadsheetId }, data: { currentVersionId: nv.id } });

    return nv;
  });

  await recordAudit({
    actorUserId: req.user.id,
    action: "SPREADSHEET_UNLOCKED",
    targetType: "SpreadsheetVersion",
    targetId: version.id,
    metadata: { newVersionId: newVersion.id, newVersionNumber: newVersion.versionNumber },
  });
  await recordAudit({
    actorUserId: req.user.id,
    action: "SPREADSHEET_VERSION_CREATED",
    targetType: "SpreadsheetVersion",
    targetId: newVersion.id,
    metadata: { versionNumber: newVersion.versionNumber },
  });

  res.json({ ok: true, newVersionId: newVersion.id, versionNumber: newVersion.versionNumber });
}

// --------------------------------------------------------------------------
// AI-ASSIST REMARK (suggestion only — never auto-saved over a manual one)
// --------------------------------------------------------------------------

async function suggestRemark(req, res) {
  const { versionId, studentId } = req.params;
  const view = await buildVersionView(versionId);
  if (!view) return res.status(404).json({ error: "Version not found" });
  const row = view.rows.find((r) => r.student.id === studentId);
  if (!row) return res.status(404).json({ error: "Student not found on this spreadsheet" });

  const suggestion = generateRemark({
    percentage: row.overall.percentage,
    grade: row.overall.finalGrade,
    attendance: row.attendance,
    psychomotorRatings: row.psychomotor,
  });

  res.json({ suggestion });
}

// --------------------------------------------------------------------------
// REPORT CARD GENERATION + PRINT (locked versions only)
// --------------------------------------------------------------------------

async function generateReportCards(req, res) {
  const version = req.targetVersion;
  if (version.status !== "LOCKED") return res.status(400).json({ error: "Lock the spreadsheet before generating report cards" });

  const settings = await prisma.schoolSettings.findUnique({ where: { id: "singleton" } });
  const students = await prisma.spreadsheetStudent.findMany({ where: { spreadsheetVersionId: version.id } });

  const results = [];
  for (const { studentId } of students) {
    const reportCard = await getOrCreateReportCard(studentId, version.id);
    await renderReportCardPdf(reportCard.id, settings);
    results.push({ studentId, reportCardId: reportCard.id, pdfUrl: `/api/teacher/report-cards/${reportCard.id}/pdf` });
  }

  await recordAudit({ actorUserId: req.user.id, action: "REPORT_CARDS_GENERATED", targetType: "SpreadsheetVersion", targetId: version.id });

  res.json({ ok: true, results });
}

async function printSpreadsheet(req, res) {
  const version = req.targetVersion;
  const view = await buildVersionView(version.id);
  const pdfBuffer = await renderSpreadsheetPdf(view);
  res.set("Content-Type", "application/pdf");
  res.send(pdfBuffer);
}

/** All students on this locked version, one combined PDF, each report starting on its own page. */
async function downloadBatchReportCards(req, res) {
  const version = req.targetVersion;
  if (version.status !== "LOCKED") return res.status(400).json({ error: "Lock the spreadsheet before generating report cards" });
  const settings = await prisma.schoolSettings.findUnique({ where: { id: "singleton" } });
  try {
    const pdfBuffer = await renderBatchReportCardsPdf(version.id, settings);
    await recordAudit({ actorUserId: req.user.id, action: "REPORT_CARDS_BATCH_DOWNLOADED", targetType: "SpreadsheetVersion", targetId: version.id });
    res.set("Content-Type", "application/pdf");
    res.send(pdfBuffer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/** Read-only detail for one report card generated from the teacher's own spreadsheet — powers the print-preview page. */
async function getReportCardDetail(req, res) {
  const { reportCardId } = req.params;
  const reportCard = await prisma.reportCard.findUnique({ where: { id: reportCardId }, include: { spreadsheetVersion: { include: { spreadsheet: true } } } });
  if (!reportCard) return res.status(404).json({ error: "Report card not found" });

  const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.id } });
  if (!teacher || reportCard.spreadsheetVersion.spreadsheet.teacherId !== teacher.id) {
    return res.status(403).json({ error: "Not your spreadsheet" });
  }

  const { buildReportCardDetailView } = require("../services/reportCardDetail.service");
  const view = await buildReportCardDetailView(reportCardId);
  if (!view) return res.status(404).json({ error: "Report card detail could not be built" });
  res.json(view);
}

module.exports = {
  getCreateOptions,
  createSubject,
  listMySpreadsheets,
  createSpreadsheet,
  getSpreadsheetDetail,
  getVersionDetail,
  autosave,
  lockVersion,
  unlockVersion,
  suggestRemark,
  generateReportCards,
  downloadBatchReportCards,
  getReportCardDetail,
  printSpreadsheet,
  buildVersionView,
};
