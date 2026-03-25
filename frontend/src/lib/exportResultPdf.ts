import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface ExportResultPdfInput {
  userQuestion: string;
  generatedAt?: Date;
  reportTitle: string;
  answerSummary: string;
  explanation: string;
  followUpSuggestions: string[];
  missingExplanation?: string;
  emptyResultReason?: string;
  sql?: string;
  results: Record<string, unknown>[];
  /** PNG data URL from html2canvas, optional */
  chartImageDataUrl?: string | null;
  chartCaption?: string;
  /** Max rows in the PDF table (full export can be huge). Default 200. */
  maxTableRows?: number;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export async function downloadResultPdf(input: ExportResultPdfInput): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  let y = margin;
  const when = input.generatedAt ?? new Date();

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59);
  doc.text("DataPilot analysis report", margin, y);
  y += 9;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated ${when.toLocaleString()}`, margin, y);
  y += 7;

  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.text("Question", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  const q = (input.userQuestion || "—").trim();
  const qLines = doc.splitTextToSize(q, pageW - 2 * margin);
  ensureSpace(qLines.length * 5 + 4);
  doc.text(qLines, margin, y);
  y += qLines.length * 5 + 6;

  const summary = input.answerSummary.trim();
  const explanation = input.explanation.trim();
  const missing = (input.missingExplanation ?? "").trim();
  const emptyReason = (input.emptyResultReason ?? "").trim();

  if (summary) {
    ensureSpace(24);
    doc.setFont("helvetica", "bold");
    doc.text("Executive summary", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    const sLines = doc.splitTextToSize(summary, pageW - 2 * margin);
    ensureSpace(sLines.length * 5 + 4);
    doc.text(sLines, margin, y);
    y += sLines.length * 5 + 6;
  }

  if (explanation && explanation !== summary) {
    ensureSpace(24);
    doc.setFont("helvetica", "bold");
    doc.text("What this means for the business", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    const eLines = doc.splitTextToSize(explanation, pageW - 2 * margin);
    ensureSpace(eLines.length * 5 + 4);
    doc.text(eLines, margin, y);
    y += eLines.length * 5 + 6;
  }

  if (missing) {
    ensureSpace(20);
    doc.setFont("helvetica", "bold");
    doc.text("Data coverage note", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    const mLines = doc.splitTextToSize(missing, pageW - 2 * margin);
    ensureSpace(mLines.length * 5 + 4);
    doc.text(mLines, margin, y);
    y += mLines.length * 5 + 6;
  }

  if (emptyReason && !explanation && !summary) {
    ensureSpace(16);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    const erLines = doc.splitTextToSize(emptyReason, pageW - 2 * margin);
    ensureSpace(erLines.length * 5 + 4);
    doc.text(erLines, margin, y);
    y += erLines.length * 5 + 6;
    doc.setTextColor(15, 23, 42);
  }

  const follow = input.followUpSuggestions.filter((s) => typeof s === "string" && s.trim());
  if (follow.length > 0) {
    ensureSpace(8 + follow.length * 6);
    doc.setFont("helvetica", "bold");
    doc.text("Suggested follow-up questions", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    follow.forEach((line, i) => {
      const bullet = `${i + 1}. ${line.trim()}`;
      const lines = doc.splitTextToSize(bullet, pageW - 2 * margin - 4);
      ensureSpace(lines.length * 5 + 2);
      doc.text(lines, margin + 2, y);
      y += lines.length * 5 + 2;
    });
    doc.setFontSize(11);
    y += 4;
  }

  if (input.chartImageDataUrl) {
    ensureSpace(90);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Visualization", margin, y);
    y += 6;
    const imgW = pageW - 2 * margin;
    const imgH = 72;
    try {
      doc.addImage(input.chartImageDataUrl, "PNG", margin, y, imgW, imgH, undefined, "FAST");
    } catch {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.text("Chart could not be embedded in this PDF.", margin, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
    }
    y += imgH + 4;
    if (input.chartCaption) {
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.setFont("helvetica", "italic");
      const capLines = doc.splitTextToSize(input.chartCaption, pageW - 2 * margin);
      ensureSpace(capLines.length * 4 + 4);
      doc.text(capLines, margin, y);
      y += capLines.length * 4 + 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
    }
    y += 4;
  }

  const maxRows = input.maxTableRows ?? 200;
  if (input.results.length > 0) {
    const columns = Object.keys(input.results[0]);
    const slice = input.results.slice(0, maxRows);
    const rows = slice.map((row) => columns.map((c) => cellText(row[c])));

    ensureSpace(16);
    doc.setFont("helvetica", "bold");
    doc.text("Detailed results", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");

    autoTable(doc, {
      startY: y,
      head: [columns],
      body: rows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7, cellPadding: 1.2, overflow: "linebreak" },
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: 255,
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      tableWidth: "wrap",
    });

    const docExt = doc as jsPDF & { lastAutoTable?: { finalY: number } };
    y = (docExt.lastAutoTable?.finalY ?? y) + 6;

    if (input.results.length > maxRows) {
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Showing the first ${maxRows} of ${input.results.length} rows. Export from your warehouse for the full dataset.`,
        margin,
        y
      );
      y += 6;
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
    }
  }

  const sql = (input.sql ?? "").trim();
  if (sql) {
    doc.addPage();
    y = margin;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("Appendix: SQL query", margin, y);
    y += 7;
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    const sqlLines = doc.splitTextToSize(sql, pageW - 2 * margin);
    const sqlLineH = 3.6;
    for (let i = 0; i < sqlLines.length; i++) {
      if (y + sqlLineH > pageH - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(sqlLines[i], margin, y);
      y += sqlLineH;
    }
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.setFont("helvetica", "normal");
    doc.text(`Page ${i} of ${totalPages}`, pageW - margin - 22, pageH - 8);
    doc.text("DataPilot", margin, pageH - 8);
  }

  const safeTitle = input.reportTitle
    .replace(/[^\w\s-]/g, "")
    .trim()
    .slice(0, 48)
    .replace(/\s+/g, "-")
    .toLowerCase();
  doc.save(`datapilot-${safeTitle || "report"}-${when.toISOString().slice(0, 10)}.pdf`);
}
