const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth.middleware");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      username: true,
      role: true,
      accountStatus: true,
      mustChangePassword: true,
      admin: { select: { securitySetupCompletedAt: true } },
      teacher: { select: { fullName: true, email: true, profileImageId: true } },
      student: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          classId: true,
          profileImageId: true,
        },
      },
    },
  });
  res.json({ user });
});

module.exports = router;
