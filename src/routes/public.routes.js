const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

/** Unauthenticated — a prospective teacher/student needs this to pick their class on the registration form. */
router.get("/classes", async (req, res) => {
  const classes = await prisma.class.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  res.json({ classes });
});

/** School name/address for the spreadsheet header — not sensitive, it's printed on every report card. */
router.get("/school-info", async (req, res) => {
  const settings = await prisma.schoolSettings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" } });
  res.json({ schoolName: settings.schoolName, address: settings.address });
});

module.exports = router;
