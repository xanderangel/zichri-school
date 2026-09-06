const PDFDocument = require("pdfkit");

/**
 * Renders one landscape PDF of the whole spreadsheet grid — every student,
 * every subject total/grade, overall percentage, and remark. Uses the
 * SAME `view` shape that the editor and lock/report-card path already
 * compute (buildVersionView), so what's printed can never drift from
 * what's on screen or what report cards were generated from.
 *
 * Built entirely in memory (never written to disk) — most free hosts,
 * including Render's free tier, wipe local disk on every
 * restart/redeploy, so a file saved there wouldn't survive to be
 * downloaded later anyway.
 */
async function renderSpreadsheetPdf(view) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, layout: "landscape", size: "A4" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(14).fillColor("#1e40af").text("ZICHRI SCHOOL", { align: "center" });
    doc.fontSize(10).fillColor("#333").text(view.spreadsheet.title, { align: "center" });
    doc.fontSize(9).text(
      `${view.spreadsheet.sessionName} — ${view.spreadsheet.termName} — ${view.version.status === "LOCKED" ? `Version ${view.version.versionNumber} (Official)` : "DRAFT — not yet locked"}`,
      { align: "center" }
    );
    doc.moveDown();

    const colWidths = { name: 110, subject: 60, overall: 70, remark: 150 };
    let y = doc.y;
    const startX = doc.page.margins.left;

    function drawHeader() {
      let x = startX;
      doc.fontSize(8).fillColor("#1e40af");
      doc.text("Name", x, y, { width: colWidths.name }); x += colWidths.name;
      view.subjects.forEach((subj) => { doc.text(subj.name, x, y, { width: colWidths.subject }); x += colWidths.subject; });
      doc.text("Total / %", x, y, { width: colWidths.overall }); x += colWidths.overall;
      doc.text("Grade", x, y, { width: 40 }); x += 40;
      doc.text("Remark", x, y, { width: colWidths.remark });
      y += 16;
      doc.moveTo(startX, y - 2).lineTo(doc.page.width - doc.page.margins.right, y - 2).strokeColor("#93c5fd").stroke();
    }

    drawHeader();

    view.rows.forEach((row) => {
      if (y > doc.page.height - 60) { doc.addPage(); y = doc.page.margins.top; drawHeader(); }
      let x = startX;
      doc.fontSize(8).fillColor("#000");
      doc.text(`${row.student.firstName} ${row.student.lastName}`, x, y, { width: colWidths.name }); x += colWidths.name;
      view.subjects.forEach((subj) => {
        const sc = row.scores[subj.id];
        doc.text(sc?.totalScore != null ? `${sc.totalScore} (${sc.grade || "-"})` : "-", x, y, { width: colWidths.subject });
        x += colWidths.subject;
      });
      doc.text(`${row.overall.totalScore}/${row.overall.maxScore} (${row.overall.percentage}%)`, x, y, { width: colWidths.overall }); x += colWidths.overall;
      doc.text(row.overall.finalGrade, x, y, { width: 40 }); x += 40;
      doc.text(row.remark || "-", x, y, { width: colWidths.remark });
      y += 16;
    });

    doc.end();
  });
}

module.exports = { renderSpreadsheetPdf };
