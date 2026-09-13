const PDFDocument = require("pdfkit");
const prisma = require("../lib/prisma");
const grading = require("../lib/grading");
const { buildReportCardDetailView } = require("./reportCardDetail.service");

// ============================================================================
// Report card creation (data layer)
// ============================================================================

/**
 * Ensures a ReportCard row exists for (student, lockedVersion), creating
 * it from a live snapshot if it doesn't. This is idempotent — calling it
 * twice for the same pair returns the same row — because @@unique on
 * (studentId, spreadsheetVersionId) in the schema prevents duplicates.
 * The snapshot fields are copied ONCE here and never touched again,
 * which is what keeps a report card correct even if the student's
 * live profile (name spelling, class) changes years later.
 */
async function getOrCreateReportCard(studentId, spreadsheetVersionId) {
  const existing = await prisma.reportCard.findUnique({
    where: { studentId_spreadsheetVersionId: { studentId, spreadsheetVersionId } },
  });
  if (existing) return existing;

  const version = await prisma.spreadsheetVersion.findUnique({
    where: { id: spreadsheetVersionId },
    include: { spreadsheet: { include: { class: true, session: true, term: true } } },
  });
  if (!version) throw new Error("Spreadsheet version not found");
  if (version.status !== "LOCKED") {
    throw new Error("Report cards can only be generated from a LOCKED spreadsheet version");
  }

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) throw new Error("Student not found");

  return prisma.reportCard.create({
    data: {
      studentId,
      spreadsheetVersionId,
      snapshotFirstName: student.firstName || student.email.split("@")[0],
      snapshotLastName: student.lastName || "",
      snapshotClassName: version.spreadsheet.class.name,
      snapshotSessionName: version.spreadsheet.session.name,
      snapshotTermName: version.spreadsheet.term.name,
    },
  });
}

// ============================================================================
// PDF rendering — professional, print-ready layout.
//
// The PDF is always the "print" document (per spec: the online dashboard
// view omits Head of School's comment / signature / school-resumes; the
// PDF always includes them, since printing IS the reason those sections
// exist). Both the single-report and the all-students-in-one-file batch
// PDF call the exact same `drawOneReportCard`, so a student's individual
// download and their page inside a class-wide batch are pixel-identical.
// ============================================================================

const PAGE_MARGIN = 40;
const COLORS = { blue: "#1e3a8a", blueLight: "#dbeafe", gray: "#475569", grayLight: "#94a3b8", black: "#0f172a", border: "#cbd5e1" };

function pageBottom(doc) {
  return doc.page.height - doc.page.margins.bottom;
}

/** Adds a new page if the next block of `height` points wouldn't fit, optionally re-drawing a running header for continuation. */
function ensureSpace(doc, height, onNewPage) {
  if (doc.y + height > pageBottom(doc)) {
    doc.addPage();
    if (onNewPage) onNewPage();
  }
}

function drawSectionLabel(doc, text) {
  doc.fontSize(10).fillColor(COLORS.blue).font("Helvetica-Bold").text(text.toUpperCase(), { characterSpacing: 0.4 });
  doc.font("Helvetica");
  doc.moveDown(0.3);
}

/** Renders one complete report card at the document's current position/page. Caller decides whether to addPage() before calling this for a subsequent student. */
async function drawOneReportCard(doc, detail, schoolSettings) {
  const contentWidth = doc.page.width - PAGE_MARGIN * 2;
  const left = PAGE_MARGIN;

  // ---- Header: school identity ----
  doc.fontSize(19).fillColor(COLORS.blue).font("Helvetica-Bold").text(schoolSettings?.schoolName || "ZICHRI SCHOOL", left, doc.y, { width: contentWidth, align: "center" });
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.gray).text(schoolSettings?.address || "", { width: contentWidth, align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(12).fillColor(COLORS.black).font("Helvetica-Bold").text("TERMINAL REPORT CARD", { align: "center" });
  doc.font("Helvetica");
  doc.moveDown(0.4);
  doc.moveTo(left, doc.y).lineTo(left + contentWidth, doc.y).strokeColor(COLORS.blue).lineWidth(1.5).stroke();
  doc.moveDown(0.6);

  // ---- Student identity block: photo + info grid ----
  const photoSize = 74;
  const infoTop = doc.y;
  let photoDrawn = false;
  if (detail.student.profileImageId) {
    try {
      const file = await prisma.uploadedFile.findUnique({ where: { id: detail.student.profileImageId } });
      if (file) {
        doc.rect(left, infoTop, photoSize, photoSize).strokeColor(COLORS.border).lineWidth(1).stroke();
        doc.image(file.data, left, infoTop, { width: photoSize, height: photoSize, fit: [photoSize, photoSize] });
        photoDrawn = true;
      }
    } catch { /* fall through to placeholder */ }
  }
  if (!photoDrawn) {
    doc.rect(left, infoTop, photoSize, photoSize).fillAndStroke(COLORS.blueLight, COLORS.border);
    doc.fillColor(COLORS.blue).fontSize(8).text("NO PHOTO", left, infoTop + photoSize / 2 - 4, { width: photoSize, align: "center" });
  }

  const infoX = left + photoSize + 16;
  const infoWidth = contentWidth - photoSize - 16;
  doc.fontSize(14).fillColor(COLORS.black).font("Helvetica-Bold").text(`${detail.student.firstName} ${detail.student.lastName}`, infoX, infoTop, { width: infoWidth });
  doc.font("Helvetica").fontSize(9.5).fillColor(COLORS.gray);

  const fields = [
    ["Class", detail.student.className],
    ["Gender", detail.student.sex === "MALE" ? "Male" : detail.student.sex === "FEMALE" ? "Female" : "-"],
    ["Age", detail.student.age != null ? `${detail.student.age} yrs` : "-"],
    ["Academic Year", detail.academic.sessionName],
    ["Term", detail.academic.termName],
    ["Times School Opened", detail.attendance?.timesSchoolOpened ?? "-"],
    ["Times Present", detail.attendance?.timesPresent ?? "-"],
  ];
  let fy = infoTop + 22;
  const colWidth = infoWidth / 2;
  fields.forEach(([label, value], idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLORS.gray).text(`${label}:`, infoX + col * colWidth, fy + row * 15, { continued: true, width: colWidth });
    doc.font("Helvetica").fillColor(COLORS.black).text(` ${value}`, { width: colWidth });
  });

  doc.y = Math.max(infoTop + photoSize, fy + Math.ceil(fields.length / 2) * 15) + 14;
  doc.x = left;

  // ---- Subject table ----
  // Column layout mirrors the reference result sheet: Subject | Test /40 |
  // Exam /60 | Total /100 | Grade | Remarks — the per-subject Remarks
  // column is the grade-band label (Outstanding/Excellent/…/Fail) for
  // that subject's total, using the exact same scale as the overall
  // grade so a subject's remark and its grade are always consistent.
  drawSectionLabel(doc, "Academic Performance");
  const numColW = Math.min(64, (contentWidth - 240) / 3);
  const remarksColW = 84;
  const subjW = contentWidth - numColW * 3 - 50 - remarksColW;
  const cols = [
    { key: "name", label: "Subject", width: subjW, align: "left" },
    { key: "testScore", label: "Test /40", width: numColW, align: "center" },
    { key: "examScore", label: "Exam /60", width: numColW, align: "center" },
    { key: "totalScore", label: "Total /100", width: numColW, align: "center" },
    { key: "grade", label: "Grade", width: 50, align: "center" },
    { key: "remark", label: "Remarks", width: remarksColW, align: "center" },
  ];
  const totalTableWidth = cols.reduce((s, c) => s + c.width, 0);
  const scale = contentWidth / totalTableWidth;
  cols.forEach((c) => (c.width *= scale));

  function drawTableHeader() {
    const rowH = 20;
    let cx = left;
    doc.rect(left, doc.y, contentWidth, rowH).fill(COLORS.blue);
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(9);
    const ty = doc.y + 5;
    cols.forEach((c) => {
      doc.text(c.label, cx + 4, ty, { width: c.width - 8, align: c.align });
      cx += c.width;
    });
    doc.y += rowH;
    doc.font("Helvetica").fillColor(COLORS.black);
  }

  drawTableHeader();
  detail.subjects.forEach((subj, i) => {
    ensureSpace(doc, 20, () => {
      doc.fontSize(9).fillColor(COLORS.grayLight).text("(continued)", left, doc.y, { width: contentWidth, align: "right" });
      doc.moveDown(0.3);
      drawTableHeader();
    });
    const rowY = doc.y;
    const rowH = 19;
    if (i % 2 === 1) doc.rect(left, rowY, contentWidth, rowH).fill("#f8fafc");
    doc.fillColor(COLORS.black).fontSize(9);
    let cx = left;
    const subjectRemark = subj.totalScore != null ? grading.gradeForPercentage(subj.totalScore).label : "-";
    const rowVals = [subj.name, subj.testScore ?? "-", subj.examScore ?? "-", subj.totalScore ?? "-", subj.grade ?? "-", subjectRemark];
    cols.forEach((c, ci) => {
      doc.text(String(rowVals[ci]), cx + 4, rowY + 5, { width: c.width - 8, align: c.align });
      cx += c.width;
    });
    doc.rect(left, rowY, contentWidth, rowH).strokeColor(COLORS.border).lineWidth(0.5).stroke();
    doc.y = rowY + rowH;
  });

  // Grading key, printed once under the table for reference — the exact
  // scale specified for this system (not the reference sheet's older
  // boundaries), so what's printed always matches what was actually used
  // to compute every grade above it.
  doc.moveDown(0.3);
  const keyText = grading.GRADE_BANDS.map((b) => `${b.min}-${b.max}=${b.grade} ${b.label}`).join("   |   ");
  doc.fontSize(6.5).fillColor(COLORS.grayLight).text(keyText, left, doc.y, { width: contentWidth });
  doc.fillColor(COLORS.black);
  doc.moveDown(0.5);

  // ---- Overall summary ----
  ensureSpace(doc, 60);
  drawSectionLabel(doc, "Overall Result");
  const statBoxW = contentWidth / 5;
  const stats = [
    ["Max Score", detail.overall.maxScore],
    ["Total Score", detail.overall.totalScore],
    ["Percentage", `${detail.overall.percentage}%`],
    ["Final Grade", detail.overall.finalGrade],
    ["Remark", detail.overall.gradeLabel],
  ];
  const statY = doc.y;
  stats.forEach(([label, value], i) => {
    const bx = left + i * statBoxW;
    doc.rect(bx, statY, statBoxW - 4, 40).fillAndStroke(COLORS.blueLight, COLORS.border);
    doc.fillColor(COLORS.blue).fontSize(7.5).font("Helvetica-Bold").text(label.toUpperCase(), bx + 4, statY + 6, { width: statBoxW - 12, align: "center" });
    doc.fillColor(COLORS.black).fontSize(11).text(String(value), bx + 4, statY + 20, { width: statBoxW - 12, align: "center" });
  });
  doc.font("Helvetica");
  doc.y = statY + 48;
  doc.x = left;

  // ---- Psychomotor ratings ----
  // Table style mirrors the reference sheet: one row per trait, one
  // column per rating value (5 down to 1), with a filled marker in the
  // student's actual rating column — closer to how these are physically
  // filled in by hand than a bare number.
  ensureSpace(doc, 90);
  drawSectionLabel(doc, "Psychomotor Ratings");
  const traits = ["Handwriting", "Verbal Fluency", "Sports/Games", "Punctuality", "Drawing & Painting"];
  const traitColW = 140;
  const ratingColW = (contentWidth - traitColW) / 5;
  const psyTop = doc.y;
  const psyRowH = 18;

  // Header row: blank corner + 5,4,3,2,1
  doc.rect(left, psyTop, contentWidth, psyRowH).fill(COLORS.blue);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8);
  doc.text("Trait", left + 4, psyTop + 5, { width: traitColW - 8 });
  [5, 4, 3, 2, 1].forEach((n, i) => {
    doc.text(String(n), left + traitColW + i * ratingColW, psyTop + 5, { width: ratingColW, align: "center" });
  });
  doc.font("Helvetica").fillColor(COLORS.black);

  let py = psyTop + psyRowH;
  traits.forEach((trait, i) => {
    const rating = detail.psychomotor.find((p) => p.trait === trait)?.rating;
    if (i % 2 === 1) doc.rect(left, py, contentWidth, psyRowH).fill("#f8fafc");
    doc.fillColor(COLORS.black).fontSize(8.5).text(trait, left + 4, py + 5, { width: traitColW - 8 });
    [5, 4, 3, 2, 1].forEach((n, ci) => {
      const cx = left + traitColW + ci * ratingColW;
      if (rating === n) {
        doc.circle(cx + ratingColW / 2, py + psyRowH / 2, 5).fill(COLORS.blue);
      }
    });
    doc.rect(left, py, contentWidth, psyRowH).strokeColor(COLORS.border).lineWidth(0.5).stroke();
    py += psyRowH;
  });
  doc.fontSize(6.5).fillColor(COLORS.grayLight).text("5-Excellent   4-Very Good   3-Good   2-Fair   1-Poor", left, py + 4, { width: contentWidth });
  doc.fillColor(COLORS.black);
  doc.y = py + 18;
  doc.x = left;

  // ---- Teacher's comment ----
  ensureSpace(doc, 60);
  drawSectionLabel(doc, "Teacher's Comment");
  const commentBoxH = 46;
  doc.rect(left, doc.y, contentWidth, commentBoxH).strokeColor(COLORS.border).lineWidth(0.5).stroke();
  doc.fillColor(COLORS.black).fontSize(9.5).text(detail.teacherComment || "-", left + 8, doc.y + 8, { width: contentWidth - 16, height: commentBoxH - 16 });
  doc.y += commentBoxH + 14;
  doc.x = left;

  // ---- Print-only sections: Head of School's comment, signature, school resumes ----
  // These never appear in the online dashboard view (see the frontend's
  // print-only CSS) — the PDF is the print artifact, so they're always
  // included here regardless of who generated it or how. Laid out exactly
  // as specified: each label gets its own full-width blank line beneath it.
  ensureSpace(doc, 220, () => {});
  drawSectionLabel(doc, "Head of School's Comments");
  const hosBoxH = 90;
  doc.rect(left, doc.y, contentWidth, hosBoxH).strokeColor(COLORS.border).lineWidth(0.7).stroke();
  doc.y += hosBoxH + 18;
  doc.x = left;

  ensureSpace(doc, 90);
  doc.fontSize(9).fillColor(COLORS.gray).font("Helvetica-Bold").text("SIGNATURE:", left, doc.y);
  doc.font("Helvetica");
  doc.y += 20;
  doc.moveTo(left, doc.y).lineTo(left + contentWidth, doc.y).strokeColor(COLORS.black).lineWidth(0.7).stroke();
  doc.y += 16;
  doc.x = left;

  doc.fontSize(9).fillColor(COLORS.gray).font("Helvetica-Bold").text("DATE:", left, doc.y);
  doc.font("Helvetica");
  doc.y += 20;
  doc.moveTo(left, doc.y).lineTo(left + contentWidth, doc.y).stroke();
  doc.y += 16;
  doc.x = left;

  ensureSpace(doc, 40);
  doc.fontSize(9).fillColor(COLORS.gray).font("Helvetica-Bold").text("SCHOOL RESUMES:", left, doc.y);
  doc.font("Helvetica");
  doc.y += 20;
  doc.moveTo(left, doc.y).lineTo(left + contentWidth, doc.y).stroke();
}

/** Renders and saves the single-student PDF. Skips regeneration if one already exists — once issued, a report card's PDF is immutable, matching the historical-integrity rule. */
/** Collects a pdfkit document's output into a single in-memory Buffer instead of writing to disk. */
function pdfToBuffer(doc, drawFn) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    Promise.resolve(drawFn(doc)).then(() => doc.end()).catch(reject);
  });
}

async function renderReportCardPdf(reportCardId, schoolSettings) {
  const reportCard = await prisma.reportCard.findUnique({ where: { id: reportCardId }, include: { pdfFile: true } });
  if (!reportCard) throw new Error("Report card not found");
  if (reportCard.pdfFile) return reportCard.pdfFile;

  const detail = await buildReportCardDetailView(reportCardId);
  if (!detail) throw new Error("Report card detail could not be built");

  const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, bufferPages: true });
  const pdfBuffer = await pdfToBuffer(doc, (d) => drawOneReportCard(d, detail, schoolSettings));
  const filename = `${reportCard.id}.pdf`;

  const fileRow = await prisma.uploadedFile.create({
    data: {
      purpose: "REPORT_CARD_PDF",
      data: pdfBuffer,
      originalName: filename,
      mimeType: "application/pdf",
      sizeBytes: pdfBuffer.length,
    },
  });

  await prisma.reportCard.update({ where: { id: reportCard.id }, data: { pdfFileId: fileRow.id } });

  return fileRow;
}

/**
 * Renders every student on a locked spreadsheet version into ONE combined
 * PDF (in memory — see pdfToBuffer), each student's report starting
 * cleanly on its own page. Generated on demand each time (not persisted
 * as a DB row, since it's a derived aggregate of individually-immutable
 * report cards, not a document in its own right) — always reflects the
 * current set of issued/generated report cards for that version, safe to
 * regenerate freely since the underlying per-student data it draws from
 * is itself immutable.
 */
async function renderBatchReportCardsPdf(spreadsheetVersionId, schoolSettings) {
  const version = await prisma.spreadsheetVersion.findUnique({ where: { id: spreadsheetVersionId } });
  if (!version) throw new Error("Spreadsheet version not found");
  if (version.status !== "LOCKED") throw new Error("Only a locked version can produce official report cards");

  const students = await prisma.spreadsheetStudent.findMany({ where: { spreadsheetVersionId } });
  if (!students.length) throw new Error("No students on this spreadsheet");

  const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN, bufferPages: true });
  const pdfBuffer = await pdfToBuffer(doc, async (d) => {
    for (let i = 0; i < students.length; i++) {
      const reportCard = await getOrCreateReportCard(students[i].studentId, spreadsheetVersionId);
      const detail = await buildReportCardDetailView(reportCard.id);
      if (!detail) continue;
      if (i > 0) d.addPage(); // each student's report begins clearly on a new page
      await drawOneReportCard(d, detail, schoolSettings);
    }
  });

  return pdfBuffer;
}

module.exports = { getOrCreateReportCard, renderReportCardPdf, renderBatchReportCardsPdf };
