const { z } = require("zod");
const prisma = require("../lib/prisma");
const { recordAudit } = require("../services/audit.service");

// A single shared, school-wide calendar — everyone sees the same events.
// Only Admin can create or remove one; Teacher and Student both read
// through the same listCalendarEvents/getTodayEvents functions.

function startOfDay(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

const createSchema = z.object({
  date: z.string().min(1), // ISO date string, e.g. "2026-12-25"
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

async function createEvent(req, res) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const event = await prisma.calendarEvent.create({
    data: {
      date: startOfDay(parsed.data.date),
      title: parsed.data.title,
      description: parsed.data.description || null,
      createdByUserId: req.user.id,
    },
  });

  await recordAudit({ actorUserId: req.user.id, action: "CALENDAR_EVENT_CREATED", targetType: "CalendarEvent", targetId: event.id });
  res.status(201).json({ event });
}

async function deleteEvent(req, res) {
  const event = await prisma.calendarEvent.findUnique({ where: { id: req.params.eventId } });
  if (!event) return res.status(404).json({ error: "Event not found" });
  await prisma.calendarEvent.delete({ where: { id: event.id } });
  await recordAudit({ actorUserId: req.user.id, action: "CALENDAR_EVENT_DELETED", targetType: "CalendarEvent", targetId: event.id });
  res.json({ ok: true });
}

/** Every event in a given month — ?year=2026&month=9 (1-indexed month, matching how a person would say it). */
async function listCalendarEvents(req, res) {
  const year = Number(req.query.year);
  const month = Number(req.query.month); // 1-12
  if (!year || !month || month < 1 || month > 12) return res.status(400).json({ error: "year and month (1-12) are required" });

  const rangeStart = new Date(Date.UTC(year, month - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, month, 1)); // first day of next month, exclusive

  const events = await prisma.calendarEvent.findMany({
    where: { date: { gte: rangeStart, lt: rangeEnd } },
    orderBy: { date: "asc" },
  });
  res.json({ events });
}

/** Powers the in-app "today" reminder banner shown on each dashboard. */
async function getTodayEvents(req, res) {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const events = await prisma.calendarEvent.findMany({ where: { date: { gte: today, lt: tomorrow } } });
  res.json({ events });
}

module.exports = { createEvent, deleteEvent, listCalendarEvents, getTodayEvents };
