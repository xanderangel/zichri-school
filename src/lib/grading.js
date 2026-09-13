// ============================================================================
// Grading rules — single source of truth so the same numbers come out
// whether they're a live preview during autosave or the frozen figures
// written at lock time. Never duplicate this scale elsewhere.
// ============================================================================

const TEST_MAX = 40;
const EXAM_MAX = 60;
const SUBJECT_MAX = TEST_MAX + EXAM_MAX; // 100

const GRADE_BANDS = [
  { min: 90, max: 100, grade: "A+", label: "Outstanding" },
  { min: 80, max: 89, grade: "A", label: "Excellent" },
  { min: 70, max: 79, grade: "B+", label: "Very Good" },
  { min: 60, max: 69, grade: "B", label: "Good" },
  { min: 50, max: 59, grade: "C", label: "Average" },
  { min: 40, max: 49, grade: "D", label: "Fair" },
  { min: 0, max: 39, grade: "F", label: "Fail" },
];

// Bands are ordered highest-to-lowest by their floor (`min`). `max` is
// kept only for display purposes (e.g. the printed grading-key legend);
// it is NEVER used for the actual comparison below. An inclusive
// min/max range check on adjacent whole-number bands (e.g. A: 80–89,
// A+: 90–100) leaves a gap for any decimal percentage between 89 and 90
// — 89.5% satisfied neither band and silently fell through to the F
// fallback. Since percentage is a computed, decimal-prone value
// (totalScore ÷ maxScore × 100), that gap was hit constantly. Checking
// only the floor, on bands already sorted from highest to lowest, has
// no such gap: 89.5 correctly matches A (>= 80) before ever reaching F.
function gradeForPercentage(pct) {
  for (const band of GRADE_BANDS) {
    if (pct >= band.min) return band;
  }
  return GRADE_BANDS[GRADE_BANDS.length - 1];
}

/** Validates a raw test/exam score. Returns { valid, value } — invalid inputs are never silently clamped server-side, they're rejected so the client can re-prompt. */
function validateTestScore(v) {
  if (v === null || v === undefined || v === "") return { valid: true, value: null };
  const n = Number(v);
  if (Number.isNaN(n) || n < 0 || n > TEST_MAX) return { valid: false, value: null };
  return { valid: true, value: n };
}

function validateExamScore(v) {
  if (v === null || v === undefined || v === "") return { valid: true, value: null };
  const n = Number(v);
  if (Number.isNaN(n) || n < 0 || n > EXAM_MAX) return { valid: false, value: null };
  return { valid: true, value: n };
}

/** Total is always derived — never accepted as direct input from the client. */
function computeSubjectResult(testScore, examScore) {
  const hasTest = testScore !== null && testScore !== undefined;
  const hasExam = examScore !== null && examScore !== undefined;
  if (!hasTest && !hasExam) return { totalScore: null, grade: null };
  const total = (hasTest ? testScore : 0) + (hasExam ? examScore : 0);
  // Grade is only meaningful once both components are present — a
  // partially-filled row shows a total but no grade yet.
  if (!hasTest || !hasExam) return { totalScore: total, grade: null };
  return { totalScore: total, grade: gradeForPercentage(total).grade };
}

/**
 * Overall summary for one student across every subject on the version.
 * maxScore = subjectCount × 100 (per spec — even subjects with no score
 * entered yet still count toward the maximum, since the class expects
 * that many subjects).
 */
function computeOverallSummary(subjectTotals, subjectCount) {
  const maxScore = subjectCount * SUBJECT_MAX;
  const totalScore = subjectTotals.reduce((sum, t) => sum + (t || 0), 0);
  const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 10000) / 100 : 0;
  const band = gradeForPercentage(percentage);
  return { maxScore, totalScore, percentage, finalGrade: band.grade, gradeLabel: band.label };
}

function validateAttendance(timesSchoolOpened, timesPresent) {
  if (timesSchoolOpened === null || timesSchoolOpened === undefined) return { valid: true };
  const opened = Number(timesSchoolOpened);
  if (Number.isNaN(opened) || opened < 0) return { valid: false, reason: "School Opened must be zero or greater" };
  if (timesPresent === null || timesPresent === undefined) return { valid: true, opened };
  const present = Number(timesPresent);
  if (Number.isNaN(present) || present < 0) return { valid: false, reason: "Present cannot be negative" };
  if (present > opened) return { valid: false, reason: "Present cannot exceed School Opened" };
  return { valid: true, opened, present };
}

module.exports = {
  TEST_MAX,
  EXAM_MAX,
  SUBJECT_MAX,
  GRADE_BANDS,
  gradeForPercentage,
  validateTestScore,
  validateExamScore,
  computeSubjectResult,
  computeOverallSummary,
  validateAttendance,
};
