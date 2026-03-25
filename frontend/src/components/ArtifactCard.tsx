"use client";

import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Table2, Code, CheckCircle2, FileDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildResultPdfBlob,
  triggerPdfFileDownload,
} from "@/lib/exportResultPdf";
import { Button } from "@/components/ui/button";
import { DataChart, type ChartSpec } from "./DataChart";

interface ArtifactCardProps {
  title: string;
  explanation?: string;
  chartSpec?: ChartSpec;
  results: Record<string, unknown>[];
  sql?: string;
  dataFeasibility?: string;
  validationOk?: boolean;
  /** Original user question (for the PDF cover). */
  userQuestion?: string;
  answerSummary?: string;
  followUpSuggestions?: string[];
  missingExplanation?: string;
}

export function ArtifactCard({
  title,
  explanation,
  chartSpec,
  results,
  sql,
  dataFeasibility,
  validationOk,
  userQuestion,
  answerSummary,
  followUpSuggestions,
  missingExplanation,
}: ArtifactCardProps) {
  const chartExportRef = useRef<HTMLDivElement>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfManualUrl, setPdfManualUrl] = useState<{ url: string; name: string } | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (pdfManualUrl) URL.revokeObjectURL(pdfManualUrl.url);
    };
  }, [pdfManualUrl]);
  const [activeTab, setActiveTab] = useState<"chart" | "table" | "sql">(
    chartSpec && chartSpec.chart_type !== "table" ? "chart" : "table"
  );
  const columns = results.length > 0 ? Object.keys(results[0]) : [];
  const hasChart =
    chartSpec &&
    chartSpec.chart_type &&
    ["bar", "line", "pie", "area"].includes(chartSpec.chart_type.toLowerCase());

  const handleExportPdf = async () => {
    setPdfError(null);
    if (pdfManualUrl) {
      URL.revokeObjectURL(pdfManualUrl.url);
      setPdfManualUrl(null);
    }
    setPdfBusy(true);
    try {
      let chartImageDataUrl: string | null = null;
      if (hasChart && chartSpec && chartExportRef.current) {
        try {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
          await new Promise<void>((r) => setTimeout(r, 220));
          const canvas = await html2canvas(chartExportRef.current, {
            scale: 2.5,
            backgroundColor: "#ffffff",
            logging: false,
            useCORS: true,
            allowTaint: true,
            foreignObjectRendering: false,
          });
          chartImageDataUrl = canvas.toDataURL("image/png");
        } catch (chartErr) {
          console.warn("Chart snapshot skipped for PDF", chartErr);
        }
      }
      const xf = chartSpec?.x_field ? String(chartSpec.x_field) : "";
      const yf = chartSpec?.y_field ? String(chartSpec.y_field) : "";
      const chartCaption =
        hasChart && chartSpec
          ? [chartSpec.title, chartSpec.chart_type, xf && yf ? `${xf} vs ${yf}` : ""]
              .filter(Boolean)
              .join(" · ")
          : undefined;

      const { blob, filename } = await buildResultPdfBlob({
        userQuestion: userQuestion ?? "",
        reportTitle: title,
        answerSummary: answerSummary ?? "",
        explanation: explanation ?? "",
        followUpSuggestions: followUpSuggestions ?? [],
        missingExplanation,
        sql,
        results,
        chartImageDataUrl,
        chartCaption,
      });
      const manualUrl = URL.createObjectURL(blob);
      setPdfManualUrl({ url: manualUrl, name: filename });
      triggerPdfFileDownload(blob, filename);
    } catch (err) {
      console.error("PDF export failed", err);
      setPdfError(err instanceof Error ? err.message : "Could not create PDF");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden border-border shadow-sm">
      {hasChart && chartSpec && (
        <div
          ref={chartExportRef}
          className="pointer-events-none fixed left-0 top-0 z-0 min-h-[440px] w-[900px] bg-white p-4 pb-2 text-slate-900 opacity-0 shadow-none"
          aria-hidden
        >
          {chartSpec.title ? (
            <p className="mb-2 text-center text-sm font-semibold text-slate-800">{chartSpec.title}</p>
          ) : null}
          <DataChart
            results={results}
            chartSpec={chartSpec}
            colorPalette="export"
            chartHeightClassName="h-[400px]"
          />
        </div>
      )}
      <CardHeader className="space-y-1 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-display text-lg font-semibold">
            {title}
          </CardTitle>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer gap-1.5"
              disabled={pdfBusy}
              onClick={() => void handleExportPdf()}
            >
              {pdfBusy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <FileDown className="size-3.5" aria-hidden />
              )}
              Download PDF
            </Button>
            {pdfError && (
              <p className="w-full text-xs text-destructive sm:w-auto" role="alert">
                {pdfError}
              </p>
            )}
            {pdfManualUrl && (
              <p className="w-full text-xs text-muted-foreground sm:max-w-[220px] sm:text-right">
                No file saved?{" "}
                <a
                  href={pdfManualUrl.url}
                  download={pdfManualUrl.name}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  Download PDF
                </a>
              </p>
            )}
            {dataFeasibility && (
              <Badge
                variant={
                  dataFeasibility === "full"
                    ? "default"
                    : dataFeasibility === "partial"
                      ? "secondary"
                      : "destructive"
                }
              >
                {dataFeasibility}
              </Badge>
            )}
            {results.length > 0 && (
              <Badge variant="outline" className="gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-500/50">
                <CheckCircle2 className="size-3" aria-hidden />
                Executed
              </Badge>
            )}
            {validationOk !== undefined && (
              <Badge variant={validationOk ? "default" : "destructive"}>
                {validationOk ? "Validated" : "Validation failed"}
              </Badge>
            )}
          </div>
        </div>
        {explanation && (
          <CardDescription className="text-sm leading-relaxed">
            {explanation}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {(hasChart || sql) && (
          <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
            {hasChart && (
              <button
                type="button"
                onClick={() => setActiveTab("chart")}
                className={cn(
                  "flex min-h-[44px] min-w-[44px] cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200",
                  activeTab === "chart"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <BarChart3 className="size-4" aria-hidden />
                Chart
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab("table")}
              className={cn(
                "flex min-h-[44px] min-w-[44px] cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200",
                activeTab === "table"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Table2 className="size-4" aria-hidden />
              Table
            </button>
            {sql && (
              <button
                type="button"
                onClick={() => setActiveTab("sql")}
                className={cn(
                  "flex min-h-[44px] min-w-[44px] cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200",
                  activeTab === "sql"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Code className="size-4" aria-hidden />
                SQL
              </button>
            )}
          </div>
        )}

        {activeTab === "chart" && hasChart && chartSpec && (
          <div className="rounded-lg border border-border bg-card p-4">
            <DataChart
              results={results}
              chartSpec={chartSpec}
              renderTable={() => (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {columns.map((col) => (
                          <TableHead key={col}>{col}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.slice(0, 50).map((row, i) => (
                        <TableRow key={i}>
                          {columns.map((col) => (
                            <TableCell key={col}>
                              {String(row[col] ?? "")}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {results.length > 50 && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Showing first 50 of {results.length} rows
                    </p>
                  )}
                </div>
              )}
            />
          </div>
        )}

        {activeTab === "table" && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead key={col} className="font-medium">
                      {col}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.slice(0, 50).map((row, i) => (
                  <TableRow key={i} className="hover:bg-muted/30">
                    {columns.map((col) => (
                      <TableCell key={col} className="text-sm">
                        {String(row[col] ?? "")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {results.length > 50 && (
              <p className="border-t border-border px-4 py-2 text-sm text-muted-foreground">
                Showing first 50 of {results.length} rows
              </p>
            )}
          </div>
        )}

        {activeTab === "sql" && sql && (
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/30 p-4 text-xs leading-relaxed">
            {sql}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
