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

interface DemoPostgresFields {
  configured: boolean;
  host: string;
  port: string;
  database: string;
  schema: string;
  user: string;
  password_display: string;
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
  const { user, getAccessToken } = useAuth();
  const { setSelectedDataSourceId } = useChat();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [modal, setModal] = useState<"postgres" | "bigquery" | "csv" | null>(null);
  const [demoFields, setDemoFields] = useState<DemoPostgresFields | null>(null);
  const [demoPostgresLoading, setDemoPostgresLoading] = useState(false);
  const [demoPostgresLoadError, setDemoPostgresLoadError] = useState<string | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [bqLabel, setBqLabel] = useState("My BigQuery");
  const [bqProject, setBqProject] = useState("");
  const [bqDataset, setBqDataset] = useState("");
  const [bqSaJson, setBqSaJson] = useState("");
  const [csvLabel, setCsvLabel] = useState("");
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

  const openPostgresModal = async () => {
    setModal("postgres");
    setConnectMsg(null);
    setDemoPostgresLoadError(null);
    setDemoFields(null);
    setDemoPostgresLoading(true);
    try {
      const res = await fetchWithRetry(
        `${API_BASE}/data-sources/demo-postgres-fields`,
        undefined,
        { logLabel: "GET /data-sources/demo-postgres-fields" }
      );
      if (res.ok) {
        setDemoFields((await res.json()) as DemoPostgresFields);
      } else {
        setDemoFields(null);
        const raw = await res.text();
        let detail = raw;
        try {
          const j = JSON.parse(raw) as { detail?: unknown };
          if (typeof j.detail === "string") detail = j.detail;
        } catch {
          /* keep raw */
        }
        setDemoPostgresLoadError(
          `Could not load demo Postgres fields (HTTP ${res.status}). ${detail.slice(0, 240)}`
        );
      }
    } catch (e) {
      setDemoFields(null);
      setDemoPostgresLoadError(
        e instanceof Error ? e.message : "Network error — is the API running and CORS allowed for this origin?"
      );
    } finally {
      setDemoPostgresLoading(false);
    }
  };

  const closePostgresModal = () => {
    setModal(null);
    setDemoPostgresLoadError(null);
  };

  const authHeaders = (): Record<string, string> => {
    const token = getAccessToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  };

  const connectDemoPostgres = async () => {
    if (!user) {
      setConnectMsg("Sign in to save this connection.");
      return;
    }
    setConnectBusy(true);
    setConnectMsg(null);
    try {
      const res = await fetchWithRetry(
        `${API_BASE}/data-sources/connect/demo-postgres`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: "{}",
        },
        { logLabel: "POST /data-sources/connect/demo-postgres" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConnectMsg(typeof data.detail === "string" ? data.detail : "Connect failed");
        return;
      }
      setConnectMsg("Connected and schema saved.");
      setSelectedDataSourceId(String(data.id));
      setModal(null);
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
      const fd = new FormData();
      fd.append("file", file);
      const token = getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetchWithRetry(
        `${API_BASE}/data-sources/upload-csv?label=${encodeURIComponent(csvLabel.trim() || file.name)}`,
        { method: "POST", headers, body: fd },
        { logLabel: "POST /data-sources/upload-csv" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConnectMsg(typeof data.detail === "string" ? data.detail : "Upload failed");
        return;
      }
      setConnectMsg("Uploaded.");
      setSelectedDataSourceId(String(data.id));
      setModal(null);
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

  const ModalChrome = ({
    title,
    children,
    onClose,
  }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
  }) =>
    createPortal(
      <div
        className="fixed inset-x-0 bottom-0 top-[var(--app-chrome-header-h)] z-50 flex items-center justify-center bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-modal-title"
      >
        <Card className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto shadow-lg">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 size-8"
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

  return (
    <AppPageShell
      title="Data Sources"
      description="Connect warehouses and uploads. Env-based primary sources appear alongside saved connections when you are signed in."
      bodyClassName="space-y-6"
    >
      {fetchError && (
        <Alert variant="destructive" className="rounded-lg">
          <AlertTitle>Connection error</AlertTitle>
          <AlertDescription>{fetchError}</AlertDescription>
        </Alert>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
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
              "Set BIGQUERY_PROJECT_ID and BIGQUERY_DATASET in .env, or DATABASE_TYPE=postgres with POSTGRES_URL. Sign in to add saved sources."}
          </AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="connectors-heading">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2
            id="connectors-heading"
            className="font-display text-[14px] font-semibold tracking-tight text-foreground"
          >
            Connectors
          </h2>
          <Button onClick={() => setShowAddForm((v) => !v)} className="cursor-pointer text-[13px]" size="sm">
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
                        <CardTitle className="font-display text-[15px] font-semibold leading-snug tracking-tight text-foreground">
                          {entry.name}
                        </CardTitle>
                        <CardDescription className="mt-1 text-[13px] leading-snug text-muted-foreground">
                          {state === "live" && match?.label ? (
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
                  {openConnect && !dimmed && (
                    <CardContent className="pt-0">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="text-[12px]"
                        disabled={!user}
                        onClick={openConnect}
                      >
                        {user ? "Connect…" : "Sign in to connect"}
                      </Button>
                    </CardContent>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

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
        <ModalChrome title="PostgreSQL (demo)" onClose={closePostgresModal}>
          <p className="text-muted-foreground">
            Demo mode: fields are shown read-only. In production, analysts would edit host, database, and
            credentials and save multiple connections.
          </p>
          {demoPostgresLoading && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading values from the API…
            </div>
          )}
          {demoPostgresLoadError && (
            <Alert variant="destructive">
              <AlertDescription>{demoPostgresLoadError}</AlertDescription>
            </Alert>
          )}
          {!demoPostgresLoading && !demoPostgresLoadError && !demoFields?.configured && (
            <Alert>
              <AlertDescription>
                Set <code className="text-[11px]">DEMO_POSTGRES_*</code> in the project root{" "}
                <code className="text-[11px]">.env</code> or <code className="text-[11px]">backend/.env</code>, then
                restart the API. Use <code className="text-[11px]">DEMO_POSTGRES_DB</code> (or{" "}
                <code className="text-[11px]">DEMO_POSTGRES_DATABASE</code>) for the database name.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
            {[
              ["Host", demoFields?.host ?? ""],
              ["Port", demoFields?.port ?? "5432"],
              ["Database", demoFields?.database ?? ""],
              ["Schema", demoFields?.schema ?? "public"],
              ["User", demoFields?.user ?? ""],
              ["Password", demoFields?.password_display ?? ""],
            ].map(([k, v]) => (
              <div key={k} className="space-y-1">
                <label className="font-medium text-foreground">{k}</label>
                <Input readOnly value={v} className="cursor-default bg-muted/40 text-foreground" />
              </div>
            ))}
          </div>
          {connectMsg && <p className="text-sm text-muted-foreground">{connectMsg}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={closePostgresModal}>
              Cancel
            </Button>
            <Button type="button" onClick={connectDemoPostgres} disabled={connectBusy || !demoFields?.configured}>
              {connectBusy ? <Loader2 className="size-4 animate-spin" /> : "Connect"}
            </Button>
          </div>
        </ModalChrome>
      )}

      {modal === "bigquery" && (
        <ModalChrome title="Google BigQuery" onClose={() => setModal(null)}>
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
              className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-[12px] font-mono"
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
        </ModalChrome>
      )}

      {modal === "csv" && (
        <ModalChrome title="Upload CSV" onClose={() => setModal(null)}>
          <p className="text-muted-foreground">
            Loads into schema <code className="text-[11px]">user_uploads</code> (configurable via{" "}
            <code className="text-[11px]">CSV_UPLOAD_SCHEMA</code>). Set{" "}
            <code className="text-[11px]">SUPABASE_POSTGRES_URL</code> on the API.
          </p>
          <div className="space-y-2">
            <label className="font-medium">Label (optional)</label>
            <Input value={csvLabel} onChange={(e) => setCsvLabel(e.target.value)} placeholder="My spreadsheet" />
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
        </ModalChrome>
      )}
    </AppPageShell>
  );
}
