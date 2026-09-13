const prisma = require("../lib/prisma");

/**
 * Teacher profile + all their spreadsheets, newest first. Deliberately
 * does NOT filter out spreadsheets belonging to a now-REMOVED teacher —
 * the account status lives on User, spreadsheets are keyed by Teacher.id
 * which is never deleted, so "removed teacher's historical spreadsheets
 * remain accessible" falls out naturally rather than needing special
 * handling.
 */
async function getTeacherProfile(req, res) {
  const { teacherId } = req.params;

  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherId },
    include: {
      user: { select: { id: true, username: true, accountStatus: true, createdAt: true } },
      classAssignments: { where: { removedAt: null }, include: { class: true } },
      profileImage: true,
    },
  });
  if (!teacher) return res.status(404).json({ error: "Teacher not found" });

  const spreadsheets = await prisma.spreadsheet.findMany({
    where: { teacherId },
    include: {
      class: true,
      session: true,
      term: true,
      versions: { orderBy: { versionNumber: "desc" }, select: { id: true, versionNumber: true, status: true, lockedAt: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  res.json({
    teacher: {
      id: teacher.id,
      userId: teacher.user.id,
      fullName: teacher.fullName,
      email: teacher.email,
      profileImageId: teacher.profileImageId,
      username: teacher.user.username,
      accountStatus: teacher.user.accountStatus,
      classes: teacher.classAssignments.map((a) => ({ id: a.class.id, name: a.class.name, isPrimary: a.isPrimary })),
      createdAt: teacher.user.createdAt,
    },
    spreadsheets: spreadsheets.map((s) => ({
      id: s.id,
      title: `${s.class.name} Spreadsheet ${s.session.name}`,
      term: s.term.name,
      latestVersion: s.versions[0] || null,
      totalVersions: s.versions.length,
    })),
  });
}

async function listTeachers(req, res) {
  const { status } = req.query; // defaults to VERIFIED per spec's "display verified teachers"
  const teachers = await prisma.teacher.findMany({
    where: { user: { accountStatus: status || "VERIFIED" } },
    include: {
      user: { select: { accountStatus: true } },
      classAssignments: { where: { removedAt: null, isPrimary: true }, include: { class: true }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({
    teachers: teachers.map((t) => ({
      id: t.id,
      fullName: t.fullName,
      profileImageId: t.profileImageId,
      className: t.classAssignments[0]?.class.name || null,
      status: t.user.accountStatus,
    })),
  });
}

module.exports = { getTeacherProfile, listTeachers };
