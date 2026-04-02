"use client";

import { useState, useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AppPageShell } from "@/components/AppPageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, Database, Loader2, X, Table } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE, fetchWithRetry } from "@/lib/httpClient";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/contexts/ChatContext";
import { Skeleton } from "@/components/ui/skeleton";
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
  matchTypes: string[];
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
    id: "csv_upload",
    name: "CSV (Supabase)",
    Icon: Table,
    matchTypes: ["csv_upload"],
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

type ConnectorUiState = "live" | "live-csv" | "error" | "available" | "soon";

function connectorUiState(entry: CatalogEntry, sources: ApiSource[]): ConnectorUiState {
  const tnorm = (t: string) => t.toLowerCase();
  const match = sources.find((s) => entry.matchTypes.includes(tnorm(s.type || "")));
  if (match) {
    if (!match.healthy) return "error";
    return entry.id === "csv_upload" ? "live-csv" : "live";
  }
  if (entry.envDriven) return "available";
  return "soon";
}

function badgeForState(state: ConnectorUiState): { label: string; className: string } {
  switch (state) {
    case "live":
    case "live-csv":
      return {
        label: "Live",
        className: "bg-success/15 text-success",
      };
    case "error":
      return {
        label: "Error",
        className: "bg-destructive/10 text-destructive",
      };
    case "available":
      return {
        label: "Connect to enable",
        className: "bg-muted text-muted-foreground",
      };
    default:
      return {
        label: "Coming soon",
        className: "border border-dashed border-border bg-background text-muted-foreground",
      };
  }
}

/** Module-level modal so React does not remount the portal on every parent re-render (fixes CSV context textarea losing focus). */
function DataSourceModalChrome({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 top-[var(--app-chrome-header-h,3.75rem)] z-[70] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ds-modal-title"
    >
      <Card className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto border-border/80 bg-card/95 shadow-xl">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 z-10 size-8"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-4" />
        </Button>
        <CardHeader className="pr-10">
          <CardTitle id="ds-modal-title" className="font-display text-[15px] font-semibold tracking-tight">
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-[13px]">{children}</CardContent>
      </Card>
    </div>,
    document.body
  );
}

export default function SourcesPage() {
  const { user, getAccessToken, refreshAccessToken } = useAuth();
  const { setSelectedDataSourceId } = useChat();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [modal, setModal] = useState<"postgres" | "bigquery" | "csv" | null>(null);
  const [pgUri, setPgUri] = useState("");
  const [pgSchema, setPgSchema] = useState("public");
  const [pgLabel, setPgLabel] = useState("My PostgreSQL");
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [bqLabel, setBqLabel] = useState("My BigQuery");
  const [bqProject, setBqProject] = useState("");
  const [bqDataset, setBqDataset] = useState("");
  const [bqSaJson, setBqSaJson] = useState("");
  const [csvLabel, setCsvLabel] = useState("");
  const [csvImportContext, setCsvImportContext] = useState("");
  const csvRef = useRef<HTMLInputElement>(null);

  const loadStatus = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const headers: Record<string, string> = {};
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetchWithRetry(`${API_BASE}/data-sources/status`, { headers }, {
        logLabel: "GET /data-sources/status",
      });
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
    } catch {
      setFetchError("Could not reach the API. Is the backend running?");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on user session
  }, [user?.id]);

  const openPostgresModal = () => {
    setModal("postgres");
    setConnectMsg(null);
  };

  const closePostgresModal = () => {
    setModal(null);
  };

  const authHeaders = (): Record<string, string> => {
    const token = getAccessToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  };

  const connectPostgres = async () => {
    if (!user) {
      setConnectMsg("Sign in to save this connection.");
      return;
    }
    if (!pgUri.trim()) {
      setConnectMsg("Paste a connection URI.");
      return;
    }
    setConnectBusy(true);
    setConnectMsg(null);

    let token = getAccessToken();
    if (!token) {
      token = await refreshAccessToken();
    }
    if (!token) {
      setConnectMsg("Session expired — sign out and sign back in.");
      setConnectBusy(false);
      return;
    }

    const doPost = (accessToken: string) =>
      fetchWithRetry(
        `${API_BASE}/data-sources/connect/postgres`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            connection_url: pgUri.trim(),
            schema: pgSchema.trim() || "public",
            label: pgLabel.trim() || "PostgreSQL",
          }),
        },
        { logLabel: "POST /data-sources/connect/postgres" }
      );

    try {
      let res = await doPost(token);
      if (res.status === 401) {
        const t2 = await refreshAccessToken();
        if (t2) res = await doPost(t2);
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConnectMsg(
          res.status === 401
            ? "Session expired and could not be renewed. Please sign out and sign in again."
            : typeof data.detail === "string"
              ? data.detail
              : "Connect failed"
        );
        return;
      }
      setConnectMsg("Connected and schema saved.");
      setSelectedDataSourceId(String(data.id));
      setModal(null);
      setPgUri("");
      await loadStatus();
    } catch (e) {
      setConnectMsg(e instanceof Error ? e.message : "Connect failed");
    } finally {
      setConnectBusy(false);
    }
  };

  const connectBigQuery = async () => {
    if (!user) {
      setConnectMsg("Sign in to save this connection.");
      return;
    }
    setConnectBusy(true);
    setConnectMsg(null);
    try {
      let parsed: unknown = bqSaJson.trim();
      try {
        parsed = JSON.parse(bqSaJson);
      } catch {
        setConnectMsg("Service account JSON must be valid JSON.");
        setConnectBusy(false);
        return;
      }
      const res = await fetchWithRetry(
        `${API_BASE}/data-sources/connect/bigquery`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            label: bqLabel.trim() || "BigQuery",
            project_id: bqProject.trim(),
            dataset_id: bqDataset.trim(),
            service_account_json: parsed,
          }),
        },
        { logLabel: "POST /data-sources/connect/bigquery" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConnectMsg(typeof data.detail === "string" ? data.detail : "Connect failed");
        return;
      }
      setConnectMsg("Connected.");
      setSelectedDataSourceId(String(data.id));
      setModal(null);
      setBqSaJson("");
      await loadStatus();
    } catch (e) {
      setConnectMsg(e instanceof Error ? e.message : "Connect failed");
    } finally {
      setConnectBusy(false);
    }
  };

  const uploadCsv = async () => {
    if (!user) {
      setConnectMsg("Sign in to upload CSV.");
      return;
    }
    const file = csvRef.current?.files?.[0];
    if (!file) {
      setConnectMsg("Choose a CSV file.");
      return;
    }
    setConnectBusy(true);
    setConnectMsg(null);
    try {
      const buildFormData = () => {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("label", csvLabel.trim() || file.name);
        fd.append("import_context", csvImportContext.trim());
        return fd;
      };

      let token = getAccessToken();
      if (!token) {
        token = await refreshAccessToken();
      }
      if (!token) {
        setConnectMsg("Restoring your session… try again in a moment, or sign out and sign back in.");
        return;
      }

      const postUpload = (accessToken: string) =>
        fetchWithRetry(
          `${API_BASE}/data-sources/upload-csv`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
            body: buildFormData(),
          },
          { logLabel: "POST /data-sources/upload-csv", retriableStatuses: [] }
        );

      let res = await postUpload(token);
      if (res.status === 401) {
        const t2 = await refreshAccessToken();
        if (t2) {
          res = await postUpload(t2);
        }
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = typeof data.detail === "string" ? data.detail : "Upload failed";
        setConnectMsg(
          res.status === 401
            ? "Session expired and could not be renewed. Please sign out and sign in again."
            : detail
        );
        return;
      }
      setConnectMsg(
        "Uploaded. In chat, choose this source in the data source dropdown, then ask about the spreadsheet (e.g. total target revenue by region)."
      );
      setSelectedDataSourceId(String(data.id));
      setModal(null);
      setCsvImportContext("");
      if (csvRef.current) csvRef.current.value = "";
      await loadStatus();
    } catch (e) {
      setConnectMsg(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setConnectBusy(false);
    }
  };

  const sources = status?.sources ?? [];
  const hint = status?.hint;

  return (
    <AppPageShell
      title="Data Sources"
      description="Connect your data warehouses and file uploads to start asking questions."
      bodyClassName="space-y-6"
    >
      {fetchError && (
        <Alert variant="destructive" className="rounded-lg">
          <AlertTitle>Connection error</AlertTitle>
          <AlertDescription>{fetchError}</AlertDescription>
        </Alert>
      )}

      {loading && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <li key={i}>
              <Card className="h-full">
                <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-2">
                  <Skeleton className="size-11 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {!loading && !status?.configured && (
        <Alert className="rounded-lg border-dashed">
          <Database className="size-4" aria-hidden />
          <AlertTitle>No warehouse configured</AlertTitle>
          <AlertDescription>
            {hint ||
              "Set BIGQUERY_PROJECT_ID and BIGQUERY_DATASET in .env, or DATABASE_TYPE=postgres with POSTGRES_URL. Sign in to add saved sources."}
          </AlertDescription>
        </Alert>
      )}

      {!loading && (
        <section aria-labelledby="connectors-heading">
          <h2
            id="connectors-heading"
            className="mb-4 font-display text-[14px] font-semibold tracking-tight text-foreground"
          >
            Connectors
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {CONNECTOR_CATALOG.map((entry) => {
            const VendorIcon = entry.Icon;
            const state = connectorUiState(entry, sources);
            const badge = badgeForState(state);
            const match = sources.find((s) =>
              entry.matchTypes.includes((s.type || "").toLowerCase())
            );
            const dimmed = state === "soon";
            const openConnect =
              entry.id === "postgres"
                ? () => openPostgresModal()
                : entry.id === "bigquery"
                  ? () => {
                      setModal("bigquery");
                      setConnectMsg(null);
                    }
                  : entry.id === "csv_upload"
                    ? () => {
                        setModal("csv");
                        setConnectMsg(null);
                      }
                    : undefined;
            return (
              <li key={entry.id}>
                <Card
                  className={cn(
                    "flex h-full flex-col transition-colors duration-200",
                    (state === "live" || state === "live-csv") &&
                      "border-success/30 border-l-2 border-l-success/55 bg-success/5",
                    state === "error" && "border-destructive/40",
                    dimmed && "opacity-70"
                  )}
                >
                  <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
                    <div className="flex min-w-0 items-start gap-3">
                      <div
                        className={cn(
                          "flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/80",
                          (state === "live" || state === "live-csv") && "border-success/30 bg-background"
                        )}
                        aria-hidden
                      >
                        <VendorIcon className={cn(dimmed && "grayscale-[0.35] opacity-80")} />
                      </div>
                      <div className="min-w-0 pt-0.5">
                        <CardTitle className="font-display text-[15px] font-semibold leading-snug tracking-tight text-foreground">
                          {entry.name}
                        </CardTitle>
                        <CardDescription className="mt-1 text-[13px] leading-snug text-muted-foreground">
                          {(state === "live" || state === "live-csv") && match?.label ? (
                            <span className="text-foreground/85">{match.label}</span>
                          ) : state === "error" && match?.detail ? (
                            <span className="break-words text-[13px] leading-snug text-destructive">
                              {match.detail}
                            </span>
                          ) : state === "available" ? (
                            <span>
                              {entry.id === "csv_upload"
                                ? "Upload a CSV into Supabase Postgres (demo)."
                                : "Click Connect to add a saved source (sign in required)."}
                            </span>
                          ) : (
                            <span>OAuth and marketplace connectors are not available yet.</span>
                          )}
                        </CardDescription>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                        badge.className
                      )}
                    >
                      {badge.label}
                    </span>
                  </CardHeader>
                  {/* Context-aware action buttons */}
                  {!dimmed && (
                    <CardContent className="mt-auto pt-0">
                      {(state === "live" || state === "live-csv") ? (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-[12px]"
                            disabled={!user}
                            onClick={openConnect}
                          >
                            {state === "live-csv" ? "Replace file" : "Edit connection"}
                          </Button>
                        </div>
                      ) : state === "error" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-[12px]"
                          disabled={!user}
                          onClick={openConnect}
                        >
                          Reconnect
                        </Button>
                      ) : state === "available" ? (
                        <Button
                          type="button"
                          size="sm"
                          className="text-[12px]"
                          disabled={!user}
                          onClick={openConnect}
                        >
                          {user ? "Connect →" : "Sign in to connect"}
                        </Button>
                      ) : null}
                    </CardContent>
                  )}
                </Card>
              </li>
            );
            })}

            {/* + Add source card */}
            <li>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm((v) => !v);
                }}
                className="flex h-full min-h-[120px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/20 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="size-6" aria-hidden />
                <span className="text-[13px] font-medium">Add source</span>
              </button>
            </li>
          </ul>
        </section>
      )}

      {showAddForm && (
        <Card className="animate-in fade-in slide-up duration-200">
          <CardHeader>
            <CardTitle className="font-display text-[15px] font-semibold tracking-tight">
              Add data source
            </CardTitle>
            <CardDescription className="text-[13px] leading-snug">
              Upload a CSV into your Supabase Postgres (demo) or use connector cards above. Requires{" "}
              <code className="text-[12px]">DATAPILOT_CREDENTIALS_KEY</code> and migration{" "}
              <code className="text-[12px]">007_user_data_sources.sql</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-[13px]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!user}
              onClick={() => {
                setModal("csv");
                setConnectMsg(null);
              }}
            >
              {user ? "Upload CSV to Supabase…" : "Sign in to upload CSV"}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowAddForm(false)} className="cursor-pointer">
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {modal === "postgres" && (
        <DataSourceModalChrome title="PostgreSQL" onClose={closePostgresModal}>
          <p className="text-muted-foreground">
            Paste a connection URI (e.g. from Neon, Supabase, or any PostgreSQL host). Stored encrypted
            server-side.
          </p>
          <div className="space-y-2">
            <label className="font-medium">Label</label>
            <Input value={pgLabel} onChange={(e) => setPgLabel(e.target.value)} placeholder="My PostgreSQL" />
            <label className="font-medium">Connection URI</label>
            <textarea
              className="min-h-[72px] w-full rounded-md border border-input/90 bg-background px-3 py-2 text-[12px] font-mono shadow-2xs outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-2 focus:ring-ring/35"
              value={pgUri}
              onChange={(e) => setPgUri(e.target.value)}
              placeholder="postgresql://user:pass@host:5432/dbname?sslmode=require"
              spellCheck={false}
            />
            <label className="font-medium">Schema</label>
            <Input value={pgSchema} onChange={(e) => setPgSchema(e.target.value)} placeholder="public" />
          </div>
          <p className="text-[12px] text-muted-foreground">
            If your password contains <code className="text-[11px]">@</code> or <code className="text-[11px]">:</code>,
            URL-encode them as <code className="text-[11px]">%40</code> /{" "}
            <code className="text-[11px]">%3A</code> in the URI.
          </p>
          {connectMsg && <p className="text-sm text-destructive">{connectMsg}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={closePostgresModal}>
              Cancel
            </Button>
            <Button type="button" onClick={connectPostgres} disabled={connectBusy || !user || !pgUri.trim()}>
              {connectBusy ? <Loader2 className="size-4 animate-spin" /> : "Connect"}
            </Button>
          </div>
        </DataSourceModalChrome>
      )}

      {modal === "bigquery" && (
        <DataSourceModalChrome title="Google BigQuery" onClose={() => setModal(null)}>
          <p className="text-muted-foreground">
            Paste a service account JSON key with access to the dataset. Stored encrypted server-side.
          </p>
          <div className="space-y-2">
            <label className="font-medium">Label</label>
            <Input value={bqLabel} onChange={(e) => setBqLabel(e.target.value)} />
            <label className="font-medium">Project ID</label>
            <Input value={bqProject} onChange={(e) => setBqProject(e.target.value)} placeholder="my-gcp-project" />
            <label className="font-medium">Dataset</label>
            <Input value={bqDataset} onChange={(e) => setBqDataset(e.target.value)} placeholder="my_dataset" />
            <label className="font-medium">Service account JSON</label>
            <textarea
              className="min-h-[120px] w-full rounded-md border border-input/90 bg-background px-3 py-2 text-[12px] font-mono shadow-2xs outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-2 focus:ring-ring/35"
              value={bqSaJson}
              onChange={(e) => setBqSaJson(e.target.value)}
              placeholder="{ ... }"
            />
          </div>
          {connectMsg && <p className="text-sm text-destructive">{connectMsg}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={connectBigQuery}
              disabled={connectBusy || !bqProject.trim() || !bqDataset.trim() || !bqSaJson.trim()}
            >
              {connectBusy ? <Loader2 className="size-4 animate-spin" /> : "Connect"}
            </Button>
          </div>
        </DataSourceModalChrome>
      )}

      {modal === "csv" && (
        <DataSourceModalChrome title="Upload CSV" onClose={() => setModal(null)}>
          <p className="text-muted-foreground">
            Uploads go to Supabase Postgres (schema <code className="text-[11px]">user_uploads</code> by default). Copy a
            Postgres URI from Supabase via the Connect button on the project home, or from the Database section in the
            main left sidebar (the cylinder icon — not the gear Project Settings). Set{" "}
            <code className="text-[11px]">SUPABASE_POSTGRES_URL</code> in the API <code className="text-[11px]">.env</code>{" "}
            and restart the backend. On Windows, if a direct URI fails, use the session pooler URI (port 5432). If your
            database password contains <code className="text-[11px]">@</code>, put{" "}
            <code className="text-[11px]">%40</code> in the URL instead (same for <code className="text-[11px]">:</code> →{" "}
            <code className="text-[11px]">%3A</code>). Then pick this source in chat to query it.
          </p>
          <p className="text-[13px] text-muted-foreground">
            Example — monthly sales targets by region:{" "}
            <a
              className="font-medium text-foreground underline underline-offset-2 hover:text-foreground/90"
              href="/samples/store_targets.csv"
              download="store_targets.csv"
            >
              Download store_targets.csv
            </a>
          </p>
          <div className="space-y-2">
            <label className="font-medium">Label (optional)</label>
            <Input
              value={csvLabel}
              onChange={(e) => setCsvLabel(e.target.value)}
              placeholder="Store targets 2025"
            />
            <label className="font-medium">What this file is (helps the assistant)</label>
            <textarea
              className="min-h-[88px] w-full rounded-md border border-input/90 bg-background px-3 py-2 text-[13px] leading-snug shadow-2xs outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-2 focus:ring-ring/35"
              value={csvImportContext}
              onChange={(e) => setCsvImportContext(e.target.value)}
              placeholder='e.g. "Someone put monthly revenue targets by sales region in a spreadsheet. month is YYYY-MM; target_revenue_usd is USD."'
            />
            <Input ref={csvRef} type="file" accept=".csv,text/csv" className="cursor-pointer text-[12px]" />
          </div>
          {connectMsg && <p className="text-sm text-muted-foreground">{connectMsg}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={uploadCsv} disabled={connectBusy}>
              {connectBusy ? <Loader2 className="size-4 animate-spin" /> : "Upload"}
            </Button>
          </div>
        </DataSourceModalChrome>
      )}
    </AppPageShell>
  );
}
