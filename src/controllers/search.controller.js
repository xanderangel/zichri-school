const prisma = require("../lib/prisma");
const { caseInsensitive } = require("../lib/searchMode");

/**
 * One search box, categorized results — matches teacher/student name,
 * email, username, class name, and spreadsheet title all in parallel and
 * returns them grouped so the frontend can render separate sections.
 */
async function search(req, res) {
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ teachers: [], students: [], classes: [], spreadsheets: [] });
  const ci = caseInsensitive();

  const [teachers, students, classes, spreadsheets] = await Promise.all([
    prisma.teacher.findMany({
      where: {
        OR: [
          { fullName: { contains: q, ...ci } },
          { email: { contains: q, ...ci } },
          { user: { username: { contains: q, ...ci } } },
        ],
      },
      include: { user: { select: { username: true, accountStatus: true } } },
      take: 20,
    }),
    prisma.student.findMany({
      where: {
        OR: [
          { firstName: { contains: q, ...ci } },
          { lastName: { contains: q, ...ci } },
          { email: { contains: q, ...ci } },
          { user: { username: { contains: q, ...ci } } },
        ],
      },
      include: { user: { select: { username: true, accountStatus: true } }, class: true },
      take: 20,
    }),
    prisma.class.findMany({ where: { name: { contains: q, ...ci } }, take: 20 }),
    prisma.spreadsheet.findMany({
      where: { class: { name: { contains: q, ...ci } } },
      include: { class: true, session: true, term: true },
      take: 20,
    }),
  ]);

  res.json({
    teachers: teachers.map((t) => ({ id: t.id, fullName: t.fullName, email: t.email, username: t.user.username, status: t.user.accountStatus })),
    students: students.map((s) => ({
      id: s.id,
      fullName: `${s.firstName} ${s.lastName}`,
      email: s.email,
      username: s.user.username,
      status: s.user.accountStatus,
      className: s.class?.name || null,
    })),
    classes: classes.map((c) => ({ id: c.id, name: c.name, archived: c.archived })),
    spreadsheets: spreadsheets.map((s) => ({ id: s.id, title: `${s.class.name} Spreadsheet ${s.session.name}`, term: s.term.name })),
  });
}

module.exports = { search };
