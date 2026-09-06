// ============================================================================
// AI-assist teacher remark generator.
//
// This is a deterministic, rule-based generator rather than a live LLM
// call, so the feature works out of the box with no API key/network
// dependency. It reads the same signals a real model would be prompted
// with (percentage, grade, attendance, psychomotor ratings) and produces
// a natural-sounding comment. Swap the body of `generateRemark` for a
// real completion call later without touching any caller.
// ============================================================================

const OPENERS = {
  "A+": ["An outstanding performance this term.", "Exceptional results all round."],
  A: ["A very strong term academically.", "Excellent, consistent performance this term."],
  "B+": ["A very good term overall.", "Solid, above-average performance this term."],
  B: ["A good, steady performance this term.", "Good effort shown across the term."],
  C: ["An average performance this term.", "A fair, middling result this term."],
  D: ["A fair but inconsistent performance.", "Below-average results that need attention."],
  F: ["A challenging term academically.", "Performance this term falls well below expectation."],
};

function attendanceClause(attendance) {
  if (!attendance || attendance.timesSchoolOpened === undefined || attendance.timesSchoolOpened === null) return "";
  const { timesSchoolOpened, timesPresent } = attendance;
  if (!timesSchoolOpened) return "";
  const ratio = timesPresent / timesSchoolOpened;
  if (ratio >= 0.95) return " Attendance was excellent throughout the term.";
  if (ratio >= 0.85) return " Attendance was good, with only occasional absences.";
  if (ratio >= 0.7) return " Attendance was fair but should improve.";
  return " Attendance was poor and needs urgent attention.";
}

function psychomotorClause(ratings) {
  if (!ratings || !ratings.length) return "";
  const strong = ratings.filter((r) => r.rating >= 4).map((r) => r.trait);
  const weak = ratings.filter((r) => r.rating <= 2).map((r) => r.trait);
  let clause = "";
  if (strong.length) clause += ` Notably strong in ${strong.join(", ")}.`;
  if (weak.length) clause += ` Needs improvement in ${weak.join(", ")}.`;
  return clause;
}

function closer(grade) {
  if (["A+", "A"].includes(grade)) return " Keep up the excellent work.";
  if (["B+", "B"].includes(grade)) return " Continued effort will bring even better results.";
  if (grade === "C") return " More consistent effort is encouraged next term.";
  return " Extra support and consistent practice are strongly recommended.";
}

/**
 * Generates a remark. Callers must never invoke this to overwrite an
 * existing manual remark automatically — that check lives in the
 * controller, not here, since this function has no knowledge of what's
 * already saved.
 */
function generateRemark({ percentage, grade, attendance, psychomotorRatings }) {
  const openerPool = OPENERS[grade] || OPENERS.C;
  const opener = openerPool[Math.floor(Math.random() * openerPool.length)];
  const pctClause = percentage !== null && percentage !== undefined ? ` Overall score: ${percentage}%.` : "";
  return `${opener}${pctClause}${attendanceClause(attendance)}${psychomotorClause(psychomotorRatings)}${closer(grade)}`.trim();
}

module.exports = { generateRemark };
