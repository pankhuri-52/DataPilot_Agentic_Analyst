"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Loader2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface TraceEntry {
  agent: string;
  status: string;
  message?: string;
  output?: Record<string, unknown>;
}

interface AskResponse {
  plan?: Record<string, unknown>;
  data_feasibility?: string;
  nearest_plan?: Record<string, unknown>;
  missing_explanation?: string;
  sql?: string;
  results?: Record<string, unknown>[];
  validation_ok?: boolean;
  chart_spec?: {
    chart_type: string;
    x_field?: string;
    y_field?: string;
    title?: string;
  };
  explanation?: string;
  trace?: TraceEntry[];
}

export function DataPilotClient() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<AskResponse | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch(`${API_BASE}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed: ${res.status}`);
      }

      const data: AskResponse = await res.json();
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const results = response?.results;
  const columns = results && results.length > 0 ? Object.keys(results[0]) : [];

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          placeholder="Ask a question about your data..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
          className="flex-1"
        />
        <Button type="submit" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Asking...
            </>
          ) : (
            "Ask"
          )}
        </Button>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && (
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      )}

      {response && !loading && (
        <>
          {response.data_feasibility && (
            <div className="flex gap-2 items-center">
              <span className="text-sm text-muted-foreground">Data feasibility:</span>
              <Badge
                variant={
                  response.data_feasibility === "full"
                    ? "default"
                    : response.data_feasibility === "partial"
                      ? "secondary"
                      : "destructive"
                }
              >
                {response.data_feasibility}
              </Badge>
              {response.validation_ok !== undefined && (
                <Badge variant={response.validation_ok ? "default" : "destructive"}>
                  {response.validation_ok ? "Validated" : "Validation failed"}
                </Badge>
              )}
            </div>
          )}

          {response.missing_explanation && (
            <Alert>
              <AlertTitle>Partial data</AlertTitle>
              <AlertDescription>{response.missing_explanation}</AlertDescription>
            </Alert>
          )}

          {response.explanation && (
            <Card>
              <CardHeader>
                <CardTitle>Insight</CardTitle>
                <CardDescription>{response.explanation}</CardDescription>
              </CardHeader>
            </Card>
          )}

          {results && results.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {response.chart_spec?.title || "Results"}
                </CardTitle>
                <CardDescription>
                  {response.chart_spec?.chart_type && (
                    <Badge variant="outline" className="mr-2">
                      {response.chart_spec.chart_type}
                    </Badge>
                  )}
                  {response.sql && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        View SQL
                      </summary>
                      <pre className="mt-2 p-3 rounded-lg bg-muted text-xs overflow-x-auto">
                        {response.sql}
                      </pre>
                    </details>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          )}

          {response.trace && response.trace.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Agent trace</CardTitle>
                <CardDescription>
                  Step-by-step reasoning and decisions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Accordion className="w-full">
                  {response.trace.map((entry, i) => (
                    <AccordionItem key={i} value={`trace-${i}`}>
                      <AccordionTrigger>
                        <span className="flex items-center gap-2">
                          <Badge
                            variant={
                              entry.status === "success"
                                ? "default"
                                : entry.status === "error"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {entry.status}
                          </Badge>
                          {entry.agent}
                          {entry.message && (
                            <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                              — {entry.message}
                            </span>
                          )}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        {entry.output && (
                          <pre className="rounded-lg bg-muted p-3 text-xs overflow-x-auto">
                            {JSON.stringify(entry.output, null, 2)}
                          </pre>
                        )}
                        {!entry.output && entry.message && (
                          <p className="text-sm text-muted-foreground">
                            {entry.message}
                          </p>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
