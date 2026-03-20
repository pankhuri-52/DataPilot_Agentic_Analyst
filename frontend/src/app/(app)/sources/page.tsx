"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, Database, Server, Cloud, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface ApiSource {
  id: string;
  type: string;
  healthy: boolean;
  label: string;
  detail?: string | null;
}

interface StatusResponse {
  configured: boolean;
  sources: ApiSource[];
  hint?: string;
}

const typeLabels: Record<string, string> = {
  bigquery: "BigQuery",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
};

export default function SourcesPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const res = await fetch(`${API_BASE}/data-sources/status`);
        const data = (await res.json()) as StatusResponse;
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) {
          setFetchError("Could not reach the API. Is the backend running?");
          setStatus(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sources = status?.sources ?? [];
  const hint = status?.hint;

  return (
    <div className="flex flex-col min-h-screen">
      <header className="shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Data Sources
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your analytics warehouse is configured via environment variables. This page shows live
            connection status from the API.
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">
          {fetchError && (
            <Alert variant="destructive" className="rounded-lg">
              <AlertTitle>Connection error</AlertTitle>
              <AlertDescription>{fetchError}</AlertDescription>
            </Alert>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading source status…
            </div>
          )}

          {!loading && !status?.configured && (
            <Alert className="rounded-lg border-dashed">
              <Database className="size-4" aria-hidden />
              <AlertTitle>No warehouse configured</AlertTitle>
              <AlertDescription>
                {hint ||
                  "Set BIGQUERY_PROJECT_ID and BIGQUERY_DATASET in .env, or DATABASE_TYPE=postgres with POSTGRES_URL."}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              {sources.length} active source{sources.length !== 1 ? "s" : ""}
            </h2>
            <Button onClick={() => setShowAddForm(true)} className="cursor-pointer" size="sm">
              <Plus className="size-4 mr-2" aria-hidden />
              Add source
            </Button>
          </div>

          {sources.length > 0 && (
            <div className="space-y-4">
              {sources.map((source) => {
                const t = (source.type || "").toLowerCase();
                const Icon = t === "bigquery" ? Cloud : Server;
                const label = typeLabels[t] ?? source.type;
                const ok = source.healthy;
                return (
                  <Card
                    key={source.id}
                    className="transition-colors duration-200 hover:border-primary/20"
                  >
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Icon className="size-5 text-muted-foreground" aria-hidden />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-medium truncate">
                            {source.label || label}
                          </CardTitle>
                          <CardDescription>{label}</CardDescription>
                          {source.detail && !ok && (
                            <p className="mt-1 text-xs text-destructive break-words">{source.detail}</p>
                          )}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                          ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-destructive/10 text-destructive"
                        )}
                      >
                        {ok ? "Reachable" : "Error"}
                      </span>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          )}

          {showAddForm && (
            <Card className="animate-in fade-in slide-up duration-200">
              <CardHeader>
                <CardTitle>Add data source</CardTitle>
                <CardDescription>
                  Multi-source management and OAuth-style connect flows are not implemented yet. Today,
                  configure BigQuery or Postgres in the backend <code className="text-xs">.env</code>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="source-name" className="text-sm font-medium">
                    Name
                  </label>
                  <Input id="source-name" placeholder="e.g. Marketing Data" disabled className="opacity-60" />
                </div>
                <div className="space-y-2">
                  <label htmlFor="source-type" className="text-sm font-medium">
                    Type
                  </label>
                  <Input id="source-type" placeholder="BigQuery, PostgreSQL…" disabled className="opacity-60" />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowAddForm(false)} className="cursor-pointer">
                    Close
                  </Button>
                  <Button disabled className="opacity-60 cursor-not-allowed">
                    Connect (coming soon)
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
