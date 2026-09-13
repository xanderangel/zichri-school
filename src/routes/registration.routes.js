const express = require("express");
const rateLimit = require("express-rate-limit");
const ctrl = require("../controllers/registration.controller");

const router = express.Router();

const regLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30 });

router.post("/teacher", regLimiter, ctrl.registerTeacher);
router.post("/student", regLimiter, ctrl.registerStudent);

module.exports = router;
