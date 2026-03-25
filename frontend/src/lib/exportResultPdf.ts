import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/** Windows / cross-browser safe download name */
export function sanitizePdfFilename(name: string): string {
  const trimmed = name.trim() || "report.pdf";
  const withExt = trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`;
  return withExt.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 180);
}

/**
 * Download a PDF blob. Prefer this after async work instead of jsPDF.save(),
 * which uses FileSaver and is often blocked once the user-gesture chain is broken (e.g. after await html2canvas).
 */
export function triggerPdfFileDownload(blob: Blob, filename: string): void {
  if (typeof window === "undefined") return;
  const safe = sanitizePdfFilename(filename);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safe;
  a.rel = "noopener";
  a.style.cssText = "position:fixed;left:-9999px;top:0;";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 90_000);
}

export interface ExportResultPdfInput {
  userQuestion: string;
  generatedAt?: Date;
  reportTitle: string;
  answerSummary: string;
  explanation: string;
  /** Ignored in PDF export (kept for API compatibility with callers). */
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

function pdfBaseFilename(input: ExportResultPdfInput, when: Date): string {
  const safeTitle = input.reportTitle
    .replace(/[^\w\s-]/g, "")
    .trim()
    .slice(0, 48)
    .replace(/\s+/g, "-")
    .toLowerCase();
  return `datapilot-${safeTitle || "report"}-${when.toISOString().slice(0, 10)}.pdf`;
}

/** Built-in PDF fonts: Helvetica for titles, Times for readable body copy */
const FONT_HEADING = "helvetica" as const;
const FONT_BODY = "times" as const;

const BODY_LINE_MM = 5.4;
const SECTION_RULE_COLOR: [number, number, number] = [203, 213, 225];

/** Build PDF bytes (no download). Use with triggerPdfFileDownload after async chart capture. */
export async function buildResultPdfBlob(
  input: ExportResultPdfInput
): Promise<{ blob: Blob; filename: string }> {
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

  const drawSectionRule = () => {
    ensureSpace(4);
    doc.setDrawColor(...SECTION_RULE_COLOR);
    doc.setLineWidth(0.35);
    doc.line(margin, y, pageW - margin, y);
    y += 8;
  };

  const writeHeading = (text: string, size = 12) => {
    ensureSpace(size * 0.55 + 4);
    doc.setFont(FONT_HEADING, "bold");
    doc.setFontSize(size);
    doc.setTextColor(15, 23, 42);
    doc.text(text, margin, y);
    y += size * 0.55 + 2;
  };

  const writeBodyParagraph = (text: string, maxW = pageW - 2 * margin) => {
    doc.setFont(FONT_BODY, "normal");
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(text, maxW);
    ensureSpace(lines.length * BODY_LINE_MM + 2);
    doc.text(lines, margin, y);
    y += lines.length * BODY_LINE_MM + 4;
  };

  const writeSubheading = (text: string) => {
    ensureSpace(8);
    doc.setFont(FONT_HEADING, "bold");
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
    doc.text(text, margin, y);
    y += 6;
  };

  // —— Cover ——
  doc.setFont(FONT_HEADING, "bold");
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text("DataPilot analysis report", margin, y);
  y += 10;

  doc.setFont(FONT_HEADING, "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated ${when.toLocaleString()}`, margin, y);
  y += 8;

  doc.setDrawColor(...SECTION_RULE_COLOR);
  doc.line(margin, y, pageW - margin, y);
  y += 10;

  // —— Question ——
  writeHeading("Your question", 12);
  const q = (input.userQuestion || "—").trim();
  writeBodyParagraph(q);

  const summary = input.answerSummary.trim();
  const explanation = input.explanation.trim();
  const missing = (input.missingExplanation ?? "").trim();
  const emptyReason = (input.emptyResultReason ?? "").trim();

  // —— Visualization: dedicated landscape page (max size), then portrait for summary + table ——
  if (input.chartImageDataUrl && input.chartImageDataUrl.length > 200) {
    doc.addPage("a4", "l");
    const lW = doc.internal.pageSize.getWidth();
    const lH = doc.internal.pageSize.getHeight();
    let ly = margin;
    doc.setFont(FONT_HEADING, "bold");
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text("Visualization", margin, ly);
    ly += 10;
    const targetW = lW - 2 * margin;
    const maxH = lH - ly - margin - 12;
    const imgW = targetW;
    const imgH = Math.min(maxH, imgW * 0.52);
    try {
      doc.addImage(input.chartImageDataUrl, "PNG", margin, ly, imgW, imgH, undefined, "SLOW");
    } catch {
      doc.setFont(FONT_BODY, "italic");
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text("Chart could not be embedded in this PDF.", margin, ly);
      doc.setTextColor(30, 41, 59);
    }
    ly += imgH + 6;
    if (input.chartCaption) {
      doc.setFont(FONT_BODY, "italic");
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105);
      const capLines = doc.splitTextToSize(input.chartCaption, lW - 2 * margin);
      doc.text(capLines, margin, ly);
      ly += capLines.length * 4.6 + 4;
      doc.setTextColor(30, 41, 59);
    }
    doc.addPage("a4", "p");
    y = margin;
  }

  // —— Summary & insights (clubbed after chart) ——
  const hasSummaryBlock = Boolean(summary || (explanation && explanation !== summary));
  if (hasSummaryBlock) {
    drawSectionRule();
    writeHeading("Summary & insights", 13);
    if (summary) {
      writeSubheading("At a glance");
      writeBodyParagraph(summary);
    }
    if (explanation && explanation !== summary) {
      writeSubheading("What this means");
      writeBodyParagraph(explanation);
    }
  }

  if (missing) {
    drawSectionRule();
    writeHeading("Data coverage note", 11);
    doc.setFont(FONT_BODY, "normal");
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    const mLines = doc.splitTextToSize(missing, pageW - 2 * margin);
    ensureSpace(mLines.length * 5 + 4);
    doc.text(mLines, margin, y);
    y += mLines.length * 5 + 6;
    doc.setTextColor(30, 41, 59);
  }

  if (emptyReason && !explanation && !summary) {
    drawSectionRule();
    doc.setFont(FONT_BODY, "normal");
    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    const erLines = doc.splitTextToSize(emptyReason, pageW - 2 * margin);
    ensureSpace(erLines.length * BODY_LINE_MM + 4);
    doc.text(erLines, margin, y);
    y += erLines.length * BODY_LINE_MM + 6;
    doc.setTextColor(30, 41, 59);
  }

  // —— Detailed results ——
  const maxRows = input.maxTableRows ?? 200;
  const firstRow = input.results[0];
  const rowIsObject =
    firstRow != null && typeof firstRow === "object" && !Array.isArray(firstRow);
  if (input.results.length > 0 && rowIsObject) {
    drawSectionRule();
    writeHeading("Detailed results", 12);
    y += 2;
    doc.setFont(FONT_BODY, "normal");
    const columns = Object.keys(firstRow as Record<string, unknown>);
    const slice = input.results.slice(0, maxRows);
    const rows = slice.map((row) => columns.map((c) => cellText(row[c])));

    autoTable(doc, {
      startY: y,
      head: [columns],
      body: rows,
      margin: { left: margin, right: margin },
      styles: {
        font: FONT_BODY,
        fontSize: 8,
        cellPadding: 1.5,
        overflow: "linebreak",
        textColor: [30, 41, 59],
      },
      headStyles: {
        font: FONT_HEADING,
        fillColor: [30, 58, 138],
        textColor: 255,
        fontStyle: "bold",
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      tableWidth: "wrap",
    });

    const docExt = doc as jsPDF & { lastAutoTable?: { finalY: number } };
    y = (docExt.lastAutoTable?.finalY ?? y) + 6;

    if (input.results.length > maxRows) {
      doc.setFont(FONT_BODY, "italic");
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Showing the first ${maxRows} of ${input.results.length} rows. Export from your warehouse for the full dataset.`,
        margin,
        y
      );
      y += 6;
      doc.setTextColor(30, 41, 59);
    }
  }

  const sql = (input.sql ?? "").trim();
  if (sql) {
    doc.addPage("a4", "p");
    y = margin;
    writeHeading("Appendix: SQL query", 12);
    y += 2;
    doc.setFont("courier", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    const sqlLines = doc.splitTextToSize(sql, pageW - 2 * margin);
    const sqlLineH = 3.8;
    for (let i = 0; i < sqlLines.length; i++) {
      if (y + sqlLineH > pageH - margin) {
        doc.addPage("a4", "p");
        y = margin;
      }
      doc.text(sqlLines[i], margin, y);
      y += sqlLineH;
    }
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    doc.setFont(FONT_HEADING, "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${i} of ${totalPages}`, pw - margin - 22, ph - 8);
    doc.text("DataPilot", margin, ph - 8);
  }

  const filename = pdfBaseFilename(input, when);
  const blob = doc.output("blob");
  return { blob, filename };
}

export async function downloadResultPdf(input: ExportResultPdfInput): Promise<void> {
  const { blob, filename } = await buildResultPdfBlob(input);
  triggerPdfFileDownload(blob, filename);
}