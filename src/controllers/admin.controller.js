const { z } = require("zod");
const prisma = require("../lib/prisma");
const { recordAudit } = require("../services/audit.service");

// --------------------------------------------------------------------------
// ACCOUNT VERIFICATION (teacher / student)
// --------------------------------------------------------------------------

const statusSchema = z.object({
  status: z.enum(["VERIFIED", "REJECTED", "REMOVED"]),
});

async function setAccountStatus(req, res) {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid status" });
  const { userId } = req.params;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: "Account not found" });
  if (user.role === "ADMIN") return res.status(400).json({ error: "Cannot modify admin status" });

  await prisma.user.update({ where: { id: userId }, data: { accountStatus: parsed.data.status } });

  if (parsed.data.status === "REMOVED") {
    await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  await recordAudit({
    actorUserId: req.user.id,
    action:
      parsed.data.status === "VERIFIED"
        ? "ACCOUNT_VERIFIED"
        : parsed.data.status === "REJECTED"
        ? "ACCOUNT_REJECTED"
        : "ACCOUNT_REMOVED",
    targetType: "User",
    targetId: userId,
  });

  res.json({ ok: true });
}

async function listAccounts(req, res) {
  const { role, status } = req.query;
  const where = {};
  if (role) where.role = role;
  if (status) where.accountStatus = status;

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      username: true,
      role: true,
      accountStatus: true,
      createdAt: true,
      teacher: { select: { fullName: true, email: true } },
      student: { select: { firstName: true, lastName: true, email: true, classId: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ users });
}

// --------------------------------------------------------------------------
// CLASSES
// --------------------------------------------------------------------------

const classSchema = z.object({ name: z.string().min(1) });

async function createClass(req, res) {
  const parsed = classSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Class name is required" });

  const existing = await prisma.class.findUnique({ where: { name: parsed.data.name } });
  if (existing) return res.status(409).json({ error: "A class with this name already exists" });

  const klass = await prisma.class.create({ data: { name: parsed.data.name } });
  await recordAudit({ actorUserId: req.user.id, action: "CLASS_CREATED", targetType: "Class", targetId: klass.id });
  res.status(201).json({ class: klass });
}

async function listClasses(req, res) {
  const classes = await prisma.class.findMany({ where: { archived: false }, orderBy: { name: "asc" } });
  res.json({ classes });
}

async function assignTeacherToClass(req, res) {
  const { teacherId, classId } = req.body;
  if (!teacherId || !classId) return res.status(400).json({ error: "teacherId and classId are required" });

  const assignment = await prisma.classAssignment.upsert({
    where: { teacherId_classId: { teacherId, classId } },
    update: { removedAt: null },
    create: { teacherId, classId, isPrimary: true },
  });

  await recordAudit({
    actorUserId: req.user.id,
    action: "TEACHER_ASSIGNED_TO_CLASS",
    targetType: "ClassAssignment",
    targetId: assignment.id,
    metadata: { teacherId, classId },
  });

  res.json({ assignment });
}

// --------------------------------------------------------------------------
// ACADEMIC SESSIONS / TERMS
// --------------------------------------------------------------------------

async function createSession(req, res) {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Session name is required (e.g. 2026/2027)" });
  const session = await prisma.academicSession.create({ data: { name } });
  await recordAudit({ actorUserId: req.user.id, action: "SESSION_CREATED", targetType: "AcademicSession", targetId: session.id });
  res.status(201).json({ session });
}

async function createTerm(req, res) {
  const { sessionId, name } = req.body;
  if (!sessionId || !name) return res.status(400).json({ error: "sessionId and name are required" });
  const term = await prisma.term.create({ data: { sessionId, name } });
  await recordAudit({ actorUserId: req.user.id, action: "TERM_CREATED", targetType: "Term", targetId: term.id });
  res.status(201).json({ term });
}

/** Every academic session with its terms nested — powers both the admin's management screen and the teacher's create-spreadsheet wizard. */
async function listSessions(req, res) {
  const sessions = await prisma.academicSession.findMany({
    include: { terms: true },
    orderBy: { name: "desc" },
  });
  res.json({ sessions });
}

// --------------------------------------------------------------------------
// SUBJECTS
// --------------------------------------------------------------------------

async function createSubject(req, res) {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Subject name is required" });
  const existing = await prisma.subject.findUnique({ where: { name } });
  if (existing) return res.status(409).json({ error: "Subject already exists" });
  const subject = await prisma.subject.create({ data: { name } });
  await recordAudit({ actorUserId: req.user.id, action: "SUBJECT_CREATED", targetType: "Subject", targetId: subject.id });
  res.status(201).json({ subject });
}

async function listSubjects(req, res) {
  const subjects = await prisma.subject.findMany({ where: { archived: false }, orderBy: { name: "asc" } });
  res.json({ subjects });
}

// --------------------------------------------------------------------------
// SCHOOL SETTINGS
// --------------------------------------------------------------------------

async function getSchoolSettings(req, res) {
  const settings = await prisma.schoolSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  res.json({ settings });
}

const settingsSchema = z.object({
  schoolName: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  phoneNumbers: z.array(z.string()).optional(),
  administrativeEmail: z.string().email().optional(),
  reportCardSettings: z.record(z.any()).optional(),
});

async function updateSchoolSettings(req, res) {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const data = { ...parsed.data };
  if (data.phoneNumbers) data.phoneNumbers = JSON.stringify(data.phoneNumbers);
  if (data.reportCardSettings) data.reportCardSettings = JSON.stringify(data.reportCardSettings);

  const settings = await prisma.schoolSettings.upsert({
    where: { id: "singleton" },
    update: data,
    create: { id: "singleton", ...data },
  });

  await recordAudit({ actorUserId: req.user.id, action: "SCHOOL_SETTINGS_UPDATED", targetType: "SchoolSettings", targetId: "singleton" });

  res.json({ settings });
}

// --------------------------------------------------------------------------
// AUDIT LOG (read-only view for admin)
// --------------------------------------------------------------------------

async function listAuditLogs(req, res) {
  const { action, targetType, limit } = req.query;
  const where = {};
  if (action) where.action = action;
  if (targetType) where.targetType = targetType;

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(limit) || 100, 500),
    include: { actorUser: { select: { username: true, role: true } } },
  });
  res.json({ logs });
}

// --------------------------------------------------------------------------
// DASHBOARD SUMMARY / NOTIFICATIONS
// --------------------------------------------------------------------------

/**
 * Backs the dashboard's notification badge — counts of pending
 * teacher/student verifications and any recent failed deliveries an
 * admin should know about.
 */
async function getDashboardSummary(req, res) {
  // Only count failures from the last 7 days — an old delivery failure
  // (e.g. from before an email provider got fixed) shouldn't sit in this
  // badge forever with no way to clear itself. A genuinely current
  // problem still shows up promptly; a resolved one quietly ages out
  // instead of needing a manual database cleanup every time.
  const recentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [pendingTeachers, pendingStudents, failedDeliveries, verifiedTeachers, verifiedStudents, lockedSpreadsheets] = await Promise.all([
    prisma.user.count({ where: { role: "TEACHER", accountStatus: "PENDING" } }),
    prisma.user.count({ where: { role: "STUDENT", accountStatus: "PENDING" } }),
    prisma.reportCardDeliveryRecord.count({ where: { status: "FAILED", attemptedAt: { gte: recentCutoff } } }),
    prisma.user.count({ where: { role: "TEACHER", accountStatus: "VERIFIED" } }),
    prisma.user.count({ where: { role: "STUDENT", accountStatus: "VERIFIED" } }),
    prisma.spreadsheetVersion.count({ where: { status: "LOCKED" } }),
  ]);

  res.json({
    pendingTeachers,
    pendingStudents,
    failedDeliveries,
    verifiedTeachers,
    verifiedStudents,
    lockedSpreadsheets,
    notificationCount: pendingTeachers + pendingStudents + failedDeliveries,
  });
}

module.exports = {
  setAccountStatus,
  listAccounts,
  getDashboardSummary,
  createClass,
  listClasses,
  assignTeacherToClass,
  createSession,
  createTerm,
  listSessions,
  createSubject,
  listSubjects,
  getSchoolSettings,
  updateSchoolSettings,
  listAuditLogs,
};
