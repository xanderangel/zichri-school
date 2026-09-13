const express = require("express");

const router = express.Router();

router.use("/auth", require("./auth.routes"));
router.use("/register", require("./registration.routes"));
router.use("/admin", require("./admin.routes"));
router.use("/teacher", require("./teacher.routes"));
router.use("/student", require("./student.routes"));
router.use("/public", require("./public.routes"));
router.use("/me", require("./me.routes"));

router.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

module.exports = router;
