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

/** Built-in PDF fonts with app-like sans/mono balance. */
const FONT_HEADING = "helvetica" as const;
const FONT_BODY = "helvetica" as const;
const FONT_MONO = "courier" as const;

const BODY_LINE_MM = 4.9;
/** Brand primary for rules and section accents */
const SECTION_RULE_COLOR: [number, number, number] = [180, 127, 43];
/** Brand primary blue for headings */
const COLOR_HEADING: [number, number, number] = [111, 78, 29];
/** Body text: dark slate */
const COLOR_BODY: [number, number, number] = [30, 41, 59];
/** Subdued: medium slate */
const COLOR_MUTED: [number, number, number] = [71, 85, 105];

/** Build PDF bytes (no download). Use with triggerPdfFileDownload after async chart capture. */
export async function buildResultPdfBlob(
  input: ExportResultPdfInput
): Promise<{ blob: Blob; filename: string }> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  let y = margin;
  const when = input.generatedAt ?? new Date();

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const drawSectionRule = () => {
    ensureSpace(5);
    doc.setDrawColor(...SECTION_RULE_COLOR);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);
    y += 5.5;
  };

  const writeHeading = (text: string, size = 12) => {
    ensureSpace(size * 0.52 + 4);
    doc.setFont(FONT_HEADING, "bold");
    doc.setFontSize(size);
    doc.setTextColor(...COLOR_HEADING);
    doc.text(text, margin, y);
    y += size * 0.52 + 1.5;
  };

  const writeBodyParagraph = (text: string, maxW = pageW - 2 * margin) => {
    doc.setFont(FONT_BODY, "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(...COLOR_BODY);
    const lines = doc.splitTextToSize(text, maxW);
    ensureSpace(lines.length * BODY_LINE_MM + 2);
    doc.text(lines, margin, y);
    y += lines.length * BODY_LINE_MM + 2.8;
  };

  const writeSubheading = (text: string) => {
    ensureSpace(6.5);
    doc.setFont(FONT_HEADING, "bold");
    doc.setFontSize(10);
    doc.setTextColor(...COLOR_MUTED);
    doc.text(text, margin, y);
    y += 4.4;
  };

  // ── Cover ──
  // DataPilot wordmark accent bar
  doc.setFillColor(...SECTION_RULE_COLOR);
  doc.rect(margin, y, 3, 12, "F");
  doc.setFont(FONT_HEADING, "bold");
  doc.setFontSize(20);
  doc.setTextColor(...COLOR_BODY);
  doc.text("DataPilot", margin + 6, y + 8.5);
  const wordmarkWidth = doc.getTextWidth("DataPilot");
  doc.setFont(FONT_HEADING, "normal");
  doc.setFontSize(11);
  doc.setTextColor(...COLOR_MUTED);
  doc.text("Analysis report", margin + 6 + wordmarkWidth + 4, y + 8.5);
  y += 14;

  doc.setFont(FONT_HEADING, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(148, 163, 184);
  doc.text(`Generated ${when.toLocaleString()}`, margin, y);
  y += 6;

  doc.setDrawColor(...SECTION_RULE_COLOR);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 6.5;

  // ── 1. Your Question ──
  writeHeading("Your Question", 12);
  const q = (input.userQuestion || "—").trim();
  writeBodyParagraph(q);

  const summary = input.answerSummary.trim();
  const explanation = input.explanation.trim();
  const missing = (input.missingExplanation ?? "").trim();
  const emptyReason = (input.emptyResultReason ?? "").trim();
  const sql = (input.sql ?? "").trim();
  const maxRows = input.maxTableRows ?? 200;
  const firstRow = input.results[0];
  const rowIsObject =
    firstRow != null && typeof firstRow === "object" && !Array.isArray(firstRow);
  const hasResults = input.results.length > 0 && rowIsObject;
  // ── 2. Detailed Results section ──
  if (hasResults || sql) {
    drawSectionRule();
    writeHeading("Detailed Results", 13);
  }
  // ── 3. Data table ──
  if (hasResults) {
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
        cellPadding: 1.25,
        overflow: "linebreak",
        textColor: COLOR_BODY,
      },
      headStyles: {
        font: FONT_HEADING,
        fillColor: COLOR_HEADING,
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      tableWidth: "wrap",
    });

    const docExt = doc as jsPDF & { lastAutoTable?: { finalY: number } };
    y = (docExt.lastAutoTable?.finalY ?? y) + 4.5;

    if (input.results.length > maxRows) {
      doc.setFont(FONT_BODY, "normal");
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Showing the first ${maxRows} of ${input.results.length} rows.`,
        margin,
        y
      );
      y += 4.5;
    }
  }

  // ── 4. SQL query ──
  if (sql) {
    ensureSpace(14);
    drawSectionRule();
    writeHeading("SQL Query", 11);
    y += 0.6;
    doc.setFont(FONT_MONO, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLOR_BODY);
    const sqlLines = doc.splitTextToSize(sql, pageW - 2 * margin);
    const sqlLineH = 3.45;
    for (const line of sqlLines) {
      if (y + sqlLineH > pageH - margin) {
        doc.addPage("a4", "p");
        y = margin;
      }
      doc.text(line, margin, y);
      y += sqlLineH;
    }
    y += 2.5;
  }

  // ── 5. Summary ──
  const hasSummaryBlock = Boolean(summary || (explanation && explanation !== summary));
  if (hasSummaryBlock || missing || emptyReason) {
    drawSectionRule();
    writeHeading("Summary", 13);
    if (summary) {
      writeSubheading("At a glance");
      writeBodyParagraph(summary);
    }
    if (explanation && explanation !== summary) {
      writeSubheading("What this means");
      writeBodyParagraph(explanation);
    }
    if (missing) {
      writeSubheading("Data coverage note");
      doc.setFont(FONT_BODY, "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...COLOR_MUTED);
      const mLines = doc.splitTextToSize(missing, pageW - 2 * margin);
      ensureSpace(mLines.length * 4.8 + 4);
      doc.text(mLines, margin, y);
      y += mLines.length * 4.8 + 4.5;
    }
    if (emptyReason && !explanation && !summary) {
      doc.setFont(FONT_BODY, "normal");
      doc.setFontSize(10);
      doc.setTextColor(...COLOR_MUTED);
      const erLines = doc.splitTextToSize(emptyReason, pageW - 2 * margin);
      ensureSpace(erLines.length * BODY_LINE_MM + 4);
      doc.text(erLines, margin, y);
      y += erLines.length * BODY_LINE_MM + 4.5;
    }
  }

  // ── Page footers ──
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    doc.setFont(FONT_HEADING, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${i} of ${totalPages}`, pw - margin - 20, ph - 7);
    doc.setFont(FONT_HEADING, "bold");
    doc.setTextColor(...SECTION_RULE_COLOR);
    doc.text("DataPilot", margin, ph - 7);
  }

  const filename = pdfBaseFilename(input, when);
  const blob = doc.output("blob");
  return { blob, filename };
}

export async function downloadResultPdf(input: ExportResultPdfInput): Promise<void> {
  const { blob, filename } = await buildResultPdfBlob(input);
  triggerPdfFileDownload(blob, filename);
}