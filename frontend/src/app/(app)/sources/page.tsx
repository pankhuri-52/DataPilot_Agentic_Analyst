"use client";

import { useState, useEffect, type ComponentType } from "react";
import { AppPageShell } from "@/components/AppPageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, Database, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE, fetchWithRetry } from "@/lib/httpClient";
import {
  BigQueryVendorIcon,
  PostgresVendorIcon,
  SnowflakeVendorIcon,
  MySQLVendorIcon,
  SqlServerVendorIcon,
  RedshiftVendorIcon,
} from "@/components/DataSourceVendorIcons";

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

type CatalogEntry = {
  id: string;
  name: string;
  Icon: ComponentType<{ className?: string }>;
  /** API `source.type` values that map to this connector */
  matchTypes: string[];
  /** Can be wired today via backend `.env` */
  envDriven: boolean;
};

const CONNECTOR_CATALOG: CatalogEntry[] = [
  {
    id: "bigquery",
    name: "Google BigQuery",
    Icon: BigQueryVendorIcon,
    matchTypes: ["bigquery"],
    envDriven: true,
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    Icon: PostgresVendorIcon,
    matchTypes: ["postgres", "postgresql"],
    envDriven: true,
  },
  {
    id: "snowflake",
    name: "Snowflake",
    Icon: SnowflakeVendorIcon,
    matchTypes: [],
    envDriven: false,
  },
  {
    id: "mysql",
    name: "MySQL",
    Icon: MySQLVendorIcon,
    matchTypes: [],
    envDriven: false,
  },
  {
    id: "mssql",
    name: "Microsoft SQL Server",
    Icon: SqlServerVendorIcon,
    matchTypes: [],
    envDriven: false,
  },
  {
    id: "redshift",
    name: "Amazon Redshift",
    Icon: RedshiftVendorIcon,
    matchTypes: [],
    envDriven: false,
  },
];

type ConnectorUiState = "live" | "error" | "available" | "soon";

function connectorUiState(entry: CatalogEntry, sources: ApiSource[]): ConnectorUiState {
  const tnorm = (t: string) => t.toLowerCase();
  const match = sources.find((s) => entry.matchTypes.includes(tnorm(s.type || "")));
  if (match) return match.healthy ? "live" : "error";
  if (entry.envDriven) return "available";
  return "soon";
}

function badgeForState(state: ConnectorUiState): { label: string; className: string } {
  switch (state) {
    case "live":
      return {
        label: "Live",
        className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      };
    case "error":
      return {
        label: "Error",
        className: "bg-destructive/10 text-destructive",
      };
    case "available":
      return {
        label: "Not connected",
        className: "bg-muted text-muted-foreground",
      };
    default:
      return {
        label: "Coming soon",
        className: "border border-dashed border-border bg-background text-muted-foreground",
      };
  }
}

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
        const res = await fetchWithRetry(`${API_BASE}/data-sources/status`, undefined, {
          logLabel: "GET /data-sources/status",
        });
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
    <AppPageShell
      title="Data Sources"
      description="Supported platforms you can connect over time. Today the warehouse is chosen via environment variables; the badge reflects live status from the API."
      bodyClassName="space-y-6"
    >
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

      <section aria-labelledby="connectors-heading">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id="connectors-heading" className="text-sm font-medium text-foreground">
            Connectors
          </h2>
          <Button onClick={() => setShowAddForm(true)} className="cursor-pointer" size="sm">
            <Plus className="mr-2 size-4" aria-hidden />
            Add source
          </Button>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {CONNECTOR_CATALOG.map((entry) => {
            const VendorIcon = entry.Icon;
            const state = connectorUiState(entry, sources);
            const badge = badgeForState(state);
            const match = sources.find((s) =>
              entry.matchTypes.includes((s.type || "").toLowerCase())
            );
            const dimmed = state === "soon";
            return (
              <li key={entry.id}>
                <Card
                  className={cn(
                    "h-full transition-colors duration-200",
                    state === "live" && "border-emerald-500/30 bg-emerald-500/[0.03]",
                    state === "error" && "border-destructive/40",
                    dimmed && "opacity-70"
                  )}
                >
                  <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
                    <div className="flex min-w-0 items-start gap-3">
                      <div
                        className={cn(
                          "flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/80",
                          state === "live" && "border-emerald-500/25 bg-background"
                        )}
                        aria-hidden
                      >
                        <VendorIcon className={cn(dimmed && "grayscale-[0.35] opacity-80")} />
                      </div>
                      <div className="min-w-0 pt-0.5">
                        <CardTitle className="text-base font-medium leading-tight">
                          {entry.name}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {state === "live" && match?.label ? (
                            <span className="text-foreground/80">{match.label}</span>
                          ) : state === "error" && match?.detail ? (
                            <span className="break-words text-xs text-destructive">
                              {match.detail}
                            </span>
                          ) : state === "available" ? (
                            <span>Configure in server environment to activate.</span>
                          ) : (
                            <span>OAuth and multi-source UI are not available yet.</span>
                          )}
                        </CardDescription>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                        badge.className
                      )}
                    >
                      {badge.label}
                    </span>
                  </CardHeader>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

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
              <Input
                id="source-name"
                placeholder="e.g. Marketing Data"
                disabled
                className="opacity-60"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="source-type" className="text-sm font-medium">
                Type
              </label>
              <Input
                id="source-type"
                placeholder="BigQuery, PostgreSQL…"
                disabled
                className="opacity-60"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowAddForm(false)}
                className="cursor-pointer"
              >
                Close
              </Button>
              <Button disabled className="cursor-not-allowed opacity-60">
                Connect (coming soon)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </AppPageShell>
  );
}
