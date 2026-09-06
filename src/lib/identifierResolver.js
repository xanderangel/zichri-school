const prisma = require("./prisma");

/** Resolves a login identifier that may be a username OR a teacher/student email into the underlying User row (with admin profile included, since only admins have one). */
async function resolveLoginUser(identifier) {
  const byUsername = await prisma.user.findUnique({ where: { username: identifier }, include: { admin: true } });
  if (byUsername) return byUsername;

  const teacher = await prisma.teacher.findUnique({ where: { email: identifier }, include: { user: { include: { admin: true } } } });
  if (teacher) return teacher.user;

  const student = await prisma.student.findUnique({ where: { email: identifier }, include: { user: { include: { admin: true } } } });
  if (student) return student.user;

  return null;
}

module.exports = { resolveLoginUser };
