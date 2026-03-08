"use client";

import { useState } from "react";
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
import { BarChart3, Table2, Code } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataChart, type ChartSpec } from "./DataChart";

interface ArtifactCardProps {
  title: string;
  explanation?: string;
  chartSpec?: ChartSpec;
  results: Record<string, unknown>[];
  sql?: string;
  dataFeasibility?: string;
  validationOk?: boolean;
}

export function ArtifactCard({
  title,
  explanation,
  chartSpec,
  results,
  sql,
  dataFeasibility,
  validationOk,
}: ArtifactCardProps) {
  const [activeTab, setActiveTab] = useState<"chart" | "table" | "sql">(
    chartSpec && chartSpec.chart_type !== "table" ? "chart" : "table"
  );
  const columns = results.length > 0 ? Object.keys(results[0]) : [];
  const hasChart =
    chartSpec &&
    chartSpec.chart_type &&
    ["bar", "line", "pie", "area"].includes(chartSpec.chart_type.toLowerCase());

  return (
    <Card className="overflow-hidden border-border shadow-sm">
      <CardHeader className="space-y-1 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-display text-lg font-semibold">
            {title}
          </CardTitle>
          <div className="flex items-center gap-2">
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
