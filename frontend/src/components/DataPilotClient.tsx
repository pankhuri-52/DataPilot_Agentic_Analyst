"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Send, Loader2, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { PlanCard } from "./PlanCard";
import { ArtifactCard } from "./ArtifactCard";
import { ExecutionPlanPanel } from "./ExecutionPlanPanel";
import { ResponseSummary } from "./ResponseSummary";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  useChat,
  type Conversation,
  type Message,
  conversationMessagesKey,
} from "@/contexts/ChatContext";

import { API_BASE, fetchWithRetry } from "@/lib/httpClient";
import { getPdfAnalyticalQuestion } from "@/lib/pdfUserQuestion";

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
  tables_used?: string[];
  sql?: string;
  bytes_scanned?: number;
  estimated_cost?: number;
  results?: Record<string, unknown>[];
  validation_ok?: boolean;
  chart_spec?: {
    chart_type: string;
    x_field?: string;
    y_field?: string;
    title?: string;
  };
  explanation?: string;
  answer_summary?: string;
  follow_up_suggestions?: string[];
  trace?: TraceEntry[];
  empty_result_reason?: string;
  conversation_id?: string;
  thread_id?: string;
}

interface PendingInterrupt {
  reason: string;
  data: Record<string, unknown>;
  thread_id: string;
  trace?: TraceEntry[];
  plan?: Record<string, unknown>;
  data_feasibility?: string;
  tables_used?: string[];
  sql?: string;
  bytes_scanned?: number;
  estimated_cost?: number;
  cost_summary?: string;
}

const THINKING_PHRASES = [
  "Thinking…",
  "Pondering your request…",
  "Understanding the data…",
  "Planning the analysis…",
  "Mapping the schema…",
  "Formulating a strategy…",
];
const THINKING_DELAY_MS = 10000;
const PHRASE_INTERVAL_MS = 1250;

type ExecutionPlanPanelProps = React.ComponentProps<typeof ExecutionPlanPanel>;

function ThinkingThenPlan(props: ExecutionPlanPanelProps) {
  const wasLoadingOnMount = useRef(props.isLoading);
  const [showPlan, setShowPlan] = useState(!props.isLoading);
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    if (!wasLoadingOnMount.current) return;
    const phraseTimer = setInterval(
      () => setPhraseIdx((i) => (i + 1) % THINKING_PHRASES.length),
      PHRASE_INTERVAL_MS
    );
    const planTimer = setTimeout(() => {
      setShowPlan(true);
      clearInterval(phraseTimer);
    }, THINKING_DELAY_MS);
    return () => {
      clearTimeout(planTimer);
      clearInterval(phraseTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!showPlan) {
    return (
      <div className="flex items-center gap-2.5 px-1 py-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin shrink-0" />
        <span key={phraseIdx} className="animate-in fade-in duration-300">
          {THINKING_PHRASES[phraseIdx]}
        </span>
      </div>
    );
  }

  return <ExecutionPlanPanel {...props} />;
}

function titleSourceType(sourceType: string): string {
  const key = sourceType.trim().toLowerCase();
  if (key === "bigquery") return "BigQuery";
  if (key === "postgres" || key === "postgresql") return "Postgres";
  if (key === "csv" || key === "csv_upload") return "CSV";
  return key ? key.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "Source";
}

function fallbackSourceLabel(sourceType: string, id: string): string {
  return `${titleSourceType(sourceType)} (${id})`;
}

function extractPlanFromTrace(trace: TraceEntry[]): Record<string, unknown> | undefined {
  const plannerEntry = trace.find((e) => e.agent === "planner");
  if (!plannerEntry?.output) return undefined;
  const o = plannerEntry.output as Record<string, unknown>;
  const execSteps = o.execution_steps;
  const base: Record<string, unknown> = {};
  if (Array.isArray(execSteps)) {
    base.execution_steps = execSteps;
  }
  if (o.metrics && Array.isArray(o.metrics)) {
    return {
      ...base,
      metrics: o.metrics,
      dimensions: (o.dimensions as string[]) ?? [],
      filters: (o.filters as Record<string, unknown>) ?? {},
      is_valid: o.is_valid,
    };
  }
  if (o.clarifying_questions && Array.isArray(o.clarifying_questions)) {
    return {
      ...base,
      is_valid: false,
      clarifying_questions: o.clarifying_questions,
      query_scope: typeof o.query_scope === "string" ? o.query_scope : undefined,
    };
  }
  if (Object.keys(base).length > 0) {
    return base;
  }
  return undefined;
}

function hasClarifyingQuestions(plan?: Record<string, unknown>): boolean {
  const q = plan?.clarifying_questions;
  return Array.isArray(q) && q.length > 0;
}

export function DataPilotClient() {
  const { user, getAccessToken, refreshAccessToken } = useAuth();
  const {
    messages,
    patchMessages,
    getMessagesForKey,
    currentConversationId,
    setCurrentConversationId,
    fetchConversations,
    upsertConversation,
    composerQuerySeed,
    clearComposerQuerySeed,
    requestComposerQuery,
    selectedDataSourceId,
    setSelectedDataSourceId,
  } = useChat();
  const [query, setQuery] = useState("");
  const [sourceOptions, setSourceOptions] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [suggestedSource, setSuggestedSource] = useState<string | null>(null);
  const [suggestedLoading, setSuggestedLoading] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);
  /** Prevents double-submit before React commits loading/currentConversationId (avoids duplicate conversations). */
  const askInFlightRef = useRef(false);
  const continueInFlightRef = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    const id = window.setTimeout(() => scrollToBottom(), 100);
    return () => clearTimeout(id);
  }, [messages]);

  useEffect(() => {
    if (!composerQuerySeed) return;
    setQuery(composerQuerySeed.text);
    clearComposerQuerySeed();
    const id = requestAnimationFrame(() => queryInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [composerQuerySeed, clearComposerQuerySeed]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        const token = getAccessToken();
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetchWithRetry(
          `${API_BASE}/data-sources/status`,
          { headers },
          { logLabel: "GET /data-sources/status (chat)" }
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          sources?: { id: string; label: string; type?: string }[];
        };
        const opts = (data.sources ?? []).map((s) => ({
          id: s.id,
          label: s.label || fallbackSourceLabel(s.type ?? "", s.id),
        }));
        setSourceOptions(opts);
      } catch {
        if (!cancelled) setSourceOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken]);

  useEffect(() => {
    if (sourceOptions.length === 0) return;
    const ids = new Set(sourceOptions.map((o) => o.id));
    if (!ids.has(selectedDataSourceId)) {
      setSelectedDataSourceId(sourceOptions[0].id);
    }
  }, [sourceOptions, selectedDataSourceId, setSelectedDataSourceId]);

  useEffect(() => {
    if (!user) {
      setSuggestedQuestions([]);
      setSuggestedSource(null);
      setSuggestedLoading(false);
      return;
    }
    const token = getAccessToken();
    if (!token) {
      setSuggestedQuestions([]);
      setSuggestedSource(null);
      return;
    }
    let cancelled = false;
    setSuggestedLoading(true);
    const suggestedUrl = new URL(`${API_BASE}/conversations/suggested-questions`);
    suggestedUrl.searchParams.set("limit", "5");
    suggestedUrl.searchParams.set("include_kb", "true");
    if (selectedDataSourceId) {
      suggestedUrl.searchParams.set("source_id", selectedDataSourceId);
    }
    const doFetch = async (authToken: string) =>
      fetchWithRetry(
        suggestedUrl.toString(),
        { headers: { Authorization: `Bearer ${authToken}` } },
        { logLabel: "GET /conversations/suggested-questions" }
      );
    (async () => {
      try {
        let res = await doFetch(token);
        if (!cancelled && res.status === 401) {
          const newToken = await refreshAccessToken();
          if (newToken && !cancelled) res = await doFetch(newToken);
        }
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as {
          suggestions?: string[];
          source?: string;
        };
        const src = typeof data.source === "string" ? data.source : "";
        const raw = data.suggestions ?? [];
        const next = raw
          .map((s) => (typeof s === "string" ? s.trim() : ""))
          .filter((s) => s.length > 0);
        if (cancelled) return;
        setSuggestedSource(src || null);
        setSuggestedQuestions(next);
      } catch {
        if (!cancelled) {
          setSuggestedQuestions([]);
          setSuggestedSource(null);
        }
      } finally {
        if (!cancelled) setSuggestedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken, refreshAccessToken, selectedDataSourceId]);

  /** User text for the turn that owns this assistant bubble (for persistence on /ask/continue). */
  function precedingUserContent(convKey: string, assistantMessageId: string): string {
    const list = getMessagesForKey(convKey);
    const idx = list.findIndex((m) => m.id === assistantMessageId);
    for (let i = idx - 1; i >= 0; i--) {
      const m = list[i];
      if (m.role === "user" && m.content?.trim()) return m.content.trim();
    }
    return "";
  }

  type ContinueOpts =
    | boolean
    | { queryCache: "full_pipeline" | "use_cached_sql" };

  async function handleContinue(message: Message, opts: ContinueOpts = true) {
    const threadId = message.pendingInterrupt?.thread_id;
    if (!threadId) return;
    if (continueInFlightRef.current || loading) return;
    continueInFlightRef.current = true;
    const assistantMessageId = message.id;
    const convKey = conversationMessagesKey(message.conversationId ?? currentConversationId);

    setLoading(true);
    setError(null);
    patchMessages(convKey, (prev) =>
      prev.map((m) =>
        m.id === assistantMessageId
          ? { ...m, loading: true }
          : m
      )
    );

    const token = getAccessToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const continueConvId = message.conversationId ?? currentConversationId ?? undefined;

    const continueBody: Record<string, unknown> = {
      thread_id: threadId,
      conversation_id: continueConvId,
      original_query: precedingUserContent(convKey, assistantMessageId) || undefined,
      source_id: selectedDataSourceId,
    };
    if (typeof opts === "object" && opts !== null && "queryCache" in opts) {
      continueBody.resume = {
        kind: "query_cache_hit",
        action: opts.queryCache,
      };
    } else {
      continueBody.approved = typeof opts === "boolean" ? opts : true;
    }

    try {
      const res = await fetchWithRetry(
        `${API_BASE}/ask/continue`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(continueBody),
        },
        { retriableStatuses: [], logLabel: "POST /ask/continue (stream)" }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed: ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (!reader) throw new Error("No response body");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const dataMatch = line.match(/^data:\s*(.+)$/m);
          if (!dataMatch) continue;

          try {
            const event = JSON.parse(dataMatch[1].trim());
            if (event.type === "progress") {
              patchMessages(convKey, (prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMessageId) return m;
                  const newTrace = [...(m.liveTrace ?? []), event.trace_entry];
                  return { ...m, liveTrace: newTrace, pendingInterrupt: undefined, loading: true };
                })
              );
            } else if (event.type === "complete") {
              const convId = event.response?.conversation_id as string | undefined;
              if (convId) {
                setCurrentConversationId(convId);
                fetchConversations();
              }
              patchMessages(convKey, (prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        loading: false,
                        conversationId: convId ?? m.conversationId,
                        liveTrace: event.response?.trace ?? m.liveTrace,
                        response: event.response,
                        plan: event.response?.plan ?? m.plan,
                        pendingInterrupt: undefined,
                        error: undefined,
                      }
                    : m
                )
              );
            } else if (event.type === "interrupt") {
              const convId = event.conversation_id as string | undefined;
              if (convId) {
                setCurrentConversationId(convId);
                fetchConversations();
              }
              patchMessages(convKey, (prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        loading: false,
                        conversationId: convId ?? m.conversationId,
                        liveTrace: (event.trace ?? m.liveTrace) as TraceEntry[],
                        pendingInterrupt: {
                          reason: event.data?.reason ?? "unknown",
                          data: event.data ?? {},
                          thread_id: event.thread_id ?? threadId,
                          trace: event.trace,
                          plan: event.plan,
                          tables_used: event.tables_used,
                          sql: event.sql,
                          bytes_scanned: event.bytes_scanned,
                          estimated_cost: event.estimated_cost,
                          cost_summary: event.cost_summary as string | undefined,
                        },
                      }
                    : m
                )
              );
            } else if (event.type === "error") {
              patchMessages(convKey, (prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? { ...m, loading: false, error: event.message ?? "Agent error" }
                    : m
                )
              );
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      if (buffer.trim()) {
        const dataMatch = buffer.match(/^data:\s*(.+)$/m);
        if (dataMatch) {
          try {
            const event = JSON.parse(dataMatch[1].trim());
            if (event.type === "complete") {
              const convId = event.response?.conversation_id as string | undefined;
              if (convId) {
                setCurrentConversationId(convId);
                fetchConversations();
              }
              patchMessages(convKey, (prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        loading: false,
                        conversationId: convId ?? m.conversationId,
                        liveTrace: event.response?.trace ?? m.liveTrace,
                        response: event.response,
                        plan: event.response?.plan ?? m.plan,
                        pendingInterrupt: undefined,
                        error: undefined,
                      }
                    : m
                )
              );
            } else if (event.type === "interrupt") {
              const convId = event.conversation_id as string | undefined;
              if (convId) {
                setCurrentConversationId(convId);
                fetchConversations();
              }
              patchMessages(convKey, (prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        loading: false,
                        conversationId: convId ?? m.conversationId,
                        liveTrace: (event.trace ?? m.liveTrace) as TraceEntry[],
                        pendingInterrupt: {
                          reason: event.data?.reason ?? "unknown",
                          data: event.data ?? {},
                          thread_id: event.thread_id ?? threadId,
                          trace: event.trace,
                          plan: event.plan,
                          tables_used: event.tables_used,
                          sql: event.sql,
                          bytes_scanned: event.bytes_scanned,
                          estimated_cost: event.estimated_cost,
                          cost_summary: event.cost_summary as string | undefined,
                        },
                      }
                    : m
                )
              );
            } else if (event.type === "error") {
              patchMessages(convKey, (prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId ? { ...m, loading: false, error: event.message ?? "Agent error" } : m
                )
              );
            }
          } catch {
            // Ignore
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      patchMessages(convKey, (prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? { ...m, loading: false, error: err instanceof Error ? err.message : "Something went wrong" }
            : m
        )
      );
    } finally {
      continueInFlightRef.current = false;
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = query.trim();
    if (!text) return;
    if (askInFlightRef.current || loading) return;
    askInFlightRef.current = true;

    const token = getAccessToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let streamConversationId = currentConversationId;
    if (user && token && !streamConversationId) {
      const title = text.length > 80 ? `${text.slice(0, 80)}…` : text;
      try {
        const cr = await fetchWithRetry(
          `${API_BASE}/conversations`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ title }),
          },
          { retriableStatuses: [], logLabel: "POST /conversations" }
        );
        if (!cr.ok) {
          const errBody = await cr.json().catch(() => ({}));
          throw new Error(
            typeof errBody.detail === "string" ? errBody.detail : "Could not create conversation"
          );
        }
        const conv = (await cr.json()) as Conversation;
        upsertConversation(conv);
        streamConversationId = conv.id;
        setCurrentConversationId(conv.id);
        fetchConversations();
      } catch (createErr) {
        setError(createErr instanceof Error ? createErr.message : "Could not create conversation");
        askInFlightRef.current = false;
        return;
      }
    }

    const streamKey = conversationMessagesKey(streamConversationId);

    setQuery("");
    setLoading(true);
    setError(null);

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: text,
      conversationId: streamConversationId ?? undefined,
    };
    const assistantMessageId = crypto.randomUUID();
    const assistantMessage = {
      id: assistantMessageId,
      role: "assistant" as const,
      loading: true,
      liveTrace: [] as TraceEntry[],
      conversationId: streamConversationId ?? undefined,
    };
    patchMessages(streamKey, (prev) => [...prev, userMessage]);
    patchMessages(streamKey, (prev) => [...prev, assistantMessage]);

    try {
      const res = await fetchWithRetry(
        `${API_BASE}/ask/stream`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            query: text,
            conversation_id: streamConversationId || undefined,
            source_id: selectedDataSourceId,
          }),
        },
        { retriableStatuses: [], logLabel: "POST /ask/stream" }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed: ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (!reader) {
        throw new Error("No response body");
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const dataMatch = line.match(/^data:\s*(.+)$/m);
          if (!dataMatch) continue;

          try {
            const event = JSON.parse(dataMatch[1].trim());
            if (event.type === "progress") {
              patchMessages(streamKey, (prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMessageId) return m;
                  const newTrace = [...(m.liveTrace ?? []), event.trace_entry];
                  const extractedPlan = extractPlanFromTrace(newTrace);
                  return {
                    ...m,
                    liveTrace: newTrace,
                    plan: m.plan ?? extractedPlan ?? undefined,
                  };
                })
              );
            } else if (event.type === "complete") {
              const convId = event.response?.conversation_id as string | undefined;
              if (convId) {
                setCurrentConversationId(convId);
                fetchConversations();
              }
              patchMessages(streamKey, (prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        loading: false,
                        conversationId: convId ?? m.conversationId,
                        liveTrace: event.response?.trace ?? m.liveTrace,
                        response: event.response,
                        plan: event.response?.plan ?? m.plan,
                      }
                    : m
                )
              );
            } else if (event.type === "interrupt") {
              const convId = event.conversation_id as string | undefined;
              if (convId) {
                setCurrentConversationId(convId);
                fetchConversations();
              }
              patchMessages(streamKey, (prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        loading: false,
                        conversationId: convId ?? m.conversationId,
                        liveTrace: (event.trace ?? m.liveTrace) as TraceEntry[],
                        pendingInterrupt: {
                          reason: event.data?.reason ?? "unknown",
                          data: event.data ?? {},
                          thread_id: event.thread_id ?? "",
                          trace: event.trace,
                          plan: event.plan,
                          tables_used: event.tables_used,
                          sql: event.sql,
                          bytes_scanned: event.bytes_scanned,
                          estimated_cost: event.estimated_cost,
                          cost_summary: event.cost_summary as string | undefined,
                        },
                      }
                    : m
                )
              );
            } else if (event.type === "error") {
              patchMessages(streamKey, (prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        loading: false,
                        error: event.message ?? "Agent error",
                      }
                    : m
                )
              );
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      if (buffer.trim()) {
        const dataMatch = buffer.match(/^data:\s*(.+)$/m);
        if (dataMatch) {
          try {
            const event = JSON.parse(dataMatch[1].trim());
            if (event.type === "complete") {
              const convId = event.response?.conversation_id as string | undefined;
              if (convId) {
                setCurrentConversationId(convId);
                fetchConversations();
              }
              patchMessages(streamKey, (prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        loading: false,
                        conversationId: convId ?? m.conversationId,
                        liveTrace: event.response?.trace ?? m.liveTrace,
                        response: event.response,
                        plan: event.response?.plan ?? m.plan,
                      }
                    : m
                )
              );
            } else if (event.type === "interrupt") {
              const convId = event.conversation_id as string | undefined;
              if (convId) {
                setCurrentConversationId(convId);
                fetchConversations();
              }
              patchMessages(streamKey, (prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        loading: false,
                        conversationId: convId ?? m.conversationId,
                        liveTrace: (event.trace ?? m.liveTrace) as TraceEntry[],
                        pendingInterrupt: {
                          reason: event.data?.reason ?? "unknown",
                          data: event.data ?? {},
                          thread_id: event.thread_id ?? "",
                          trace: event.trace,
                          plan: event.plan,
                          tables_used: event.tables_used,
                          sql: event.sql,
                          bytes_scanned: event.bytes_scanned,
                          estimated_cost: event.estimated_cost,
                          cost_summary: event.cost_summary as string | undefined,
                        },
                      }
                    : m
                )
              );
            } else if (event.type === "error") {
              patchMessages(streamKey, (prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        loading: false,
                        error: event.message ?? "Agent error",
                      }
                    : m
                )
              );
            }
          } catch {
            // Ignore
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      patchMessages(streamKey, (prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? {
                ...m,
                loading: false,
                error: err instanceof Error ? err.message : "Something went wrong",
              }
            : m
        )
      );
    } finally {
      askInFlightRef.current = false;
      setLoading(false);
    }
  }

  const displayName =
    user?.name || user?.email?.split("@")[0] || "there";
  const selectedSourceLabel =
    sourceOptions.find((o) => o.id === selectedDataSourceId)?.label ?? "Select data source";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {messages.length === 0 ? (
        /* ── Centered empty state ── */
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
          <div className="w-full max-w-2xl space-y-6 text-center">
            <div>
              <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
                {`Hey ${displayName}, what would you like to explore today?`}
              </h2>
              {user ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Ask anything about your data, or pick one of the suggestions below.
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Sign in to save your chat history and get personalized suggestions.
                </p>
              )}
            </div>

            {/* Input form — centered when no messages */}
            {sourceOptions.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <label className="text-[12px] font-medium text-foreground/80">Data source</label>
                <Select
                  value={selectedDataSourceId}
                  onValueChange={(v) => v && setSelectedDataSourceId(v)}
                  disabled={loading}
                >
                  <SelectTrigger className="h-8 max-w-[min(100%,28rem)] text-[13px]">
                    <SelectValue>{selectedSourceLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {sourceOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id} label={o.label} className="text-[13px]">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <form
              onSubmit={handleSubmit}
              className="flex gap-2 rounded-2xl border border-border/80 bg-card/75 p-2.5 shadow-sm transition-[border-color,box-shadow,background-color] focus-within:border-primary/45 focus-within:bg-card focus-within:ring-2 focus-within:ring-primary/20"
            >
              <Input
                ref={queryInputRef}
                placeholder="Ask anything about your data…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={loading}
                className="min-h-[48px] flex-1 border-0 bg-transparent px-3 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <Button
                type="submit"
                disabled={loading}
                size="icon"
                className="size-12 shrink-0 cursor-pointer rounded-xl"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-4" aria-hidden />
                )}
                <span className="sr-only">Send</span>
              </Button>
            </form>

            {/* Animated suggestion chips */}
            {suggestedLoading && (
              <div className="flex flex-wrap justify-center gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-9 w-40 rounded-xl" />
                ))}
              </div>
            )}
            {!suggestedLoading && suggestedQuestions.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                {suggestedQuestions.map((q, i) => (
                  <button
                    key={`${i}-${q.slice(0, 64)}`}
                    type="button"
                    onClick={() => requestComposerQuery(q)}
                    style={{ animationDelay: `${i * 0.4}s` }}
                    className="animate-float rounded-xl border border-border/70 bg-card px-4 py-2.5 text-sm shadow-xs transition-[border-color,background-color,box-shadow,color] hover:border-primary/35 hover:bg-accent/55 hover:text-accent-foreground hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-6 pb-28 sm:pb-32">
            {messages.map((message, msgIndex) => (
          <div
            key={message.id}
            className={cn(
              "flex animate-in fade-in slide-up duration-200",
              message.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[85%] sm:max-w-[75%]",
                message.role === "user" ? "order-2" : "order-1 w-full"
              )}
            >
              {message.role === "user" ? (
                <div className="rounded-2xl rounded-br-md border border-primary/35 bg-primary px-4 py-3 shadow-sm text-primary-foreground">
                  <p className="text-sm leading-relaxed">{message.content}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {message.error && (
                    <Alert variant="destructive" className="rounded-lg">
                      <AlertCircle className="size-4" />
                      <AlertTitle>Something went wrong</AlertTitle>
                      <AlertDescription>{message.error}</AlertDescription>
                    </Alert>
                  )}

                  {(() => {
                    const res = message.response as AskResponse | undefined;
                    const trace = (res?.trace ?? message.liveTrace ?? []) as TraceEntry[];
                    const effectivePlan = (message.plan ??
                      res?.plan ??
                      extractPlanFromTrace(trace)) as Record<string, unknown> | undefined;
                    const clarifying = hasClarifyingQuestions(effectivePlan);
                    const showPanel =
                      !clarifying &&
                      (Boolean(message.loading) ||
                        Boolean(message.pendingInterrupt) ||
                        effectivePlan?.is_valid === true);

                    return (
                      <>
                        {clarifying && effectivePlan && <PlanCard plan={effectivePlan} />}
                        {showPanel && (
                          <ThinkingThenPlan
                            key={message.id}
                            plan={effectivePlan}
                            liveTrace={trace}
                            isLoading={Boolean(message.loading || message.pendingInterrupt)}
                            isTurnComplete={Boolean(res && !message.loading)}
                            pendingInterrupt={
                              message.pendingInterrupt
                                ? {
                                    reason: message.pendingInterrupt.reason,
                                    data: message.pendingInterrupt.data,
                                    sql: message.pendingInterrupt.sql,
                                    bytes_scanned: message.pendingInterrupt.bytes_scanned,
                                    estimated_cost: message.pendingInterrupt.estimated_cost,
                                    cost_summary: message.pendingInterrupt.cost_summary,
                                  }
                                : undefined
                            }
                            onContinue={(value) => message.pendingInterrupt && handleContinue(message, value as ContinueOpts)}
                            continueDisabled={continueInFlightRef.current || loading}
                          />
                        )}
                      </>
                    );
                  })()}

                  {message.response && !message.loading && (() => {
                    const res = message.response as AskResponse;
                    const resultsList = Array.isArray(res.results) ? res.results : [];
                    const hasRows = resultsList.length > 0;
                    const answerSummary = res.answer_summary?.trim() || "";
                    const followUps = res.follow_up_suggestions ?? [];
                    const explanationText = (res.explanation ?? "").trim();
                    const emptyReason = (res.empty_result_reason as string | undefined)?.trim();
                    const showOutcomeCard =
                      !hasRows &&
                      (explanationText.length > 0 || !!emptyReason || !!res.chart_spec);
                    const summaryDupesExplanation =
                      !hasRows &&
                      explanationText.length > 0 &&
                      answerSummary.length > 0 &&
                      explanationText === answerSummary;
                    return (
                      <div className="space-y-4">
                        {res.missing_explanation && (
                          <Alert className="rounded-lg">
                            <AlertTitle>Partial data</AlertTitle>
                            <AlertDescription>{res.missing_explanation}</AlertDescription>
                          </Alert>
                        )}
                        {hasRows && (
                          <ArtifactCard
                            title={res.chart_spec?.title || "Results"}
                            explanation={res.explanation}
                            chartSpec={res.chart_spec}
                            results={resultsList}
                            sql={res.sql}
                            dataFeasibility={res.data_feasibility}
                            validationOk={res.validation_ok}
                            userQuestion={getPdfAnalyticalQuestion(messages, msgIndex)}
                            fetchUserQuestion={async () => {
                              try {
                                const token = getAccessToken();
                                const headers: Record<string, string> = { "Content-Type": "application/json" };
                                if (token) headers.Authorization = `Bearer ${token}`;
                                const r = await fetchWithRetry(
                                  `${API_BASE}/chat/summarise-topic`,
                                  {
                                    method: "POST",
                                    headers,
                                    body: JSON.stringify({
                                      messages: messages.slice(0, msgIndex + 1).map((m) => ({
                                        role: m.role,
                                        content: m.content ?? "",
                                      })),
                                    }),
                                  },
                                  { retriableStatuses: [], logLabel: "POST /chat/summarise-topic" }
                                );
                                if (!r.ok) return getPdfAnalyticalQuestion(messages, msgIndex);
                                const data = (await r.json()) as { topic?: string };
                                return data.topic?.trim() || getPdfAnalyticalQuestion(messages, msgIndex);
                              } catch {
                                return getPdfAnalyticalQuestion(messages, msgIndex);
                              }
                            }}
                            answerSummary={summaryDupesExplanation ? "" : answerSummary}
                            followUpSuggestions={followUps}
                            missingExplanation={
                              typeof res.missing_explanation === "string"
                                ? res.missing_explanation
                                : undefined
                            }
                          />
                        )}
                        {showOutcomeCard && (
                          <div className="rounded-xl border border-border/80 bg-card/85 p-4 shadow-xs space-y-3">
                            <p className="text-sm font-medium">Outcome</p>
                            {explanationText && (
                              <p className="text-sm text-muted-foreground">{res.explanation}</p>
                            )}
                            {emptyReason && !explanationText && (
                              <p className="text-sm text-muted-foreground">{emptyReason}</p>
                            )}
                            {emptyReason &&
                              explanationText &&
                              emptyReason !== explanationText && (
                                <p className="text-sm text-muted-foreground border-t border-border/60 pt-2 mt-1">
                                  {emptyReason}
                                </p>
                              )}
                          </div>
                        )}
                        {!hasRows &&
                          !showOutcomeCard &&
                          !res.missing_explanation &&
                          (res.validation_ok !== undefined || res.trace) && (
                            <p className="text-sm text-muted-foreground">
                              No results found — try rephrasing your question.
                            </p>
                          )}
                        {(answerSummary || followUps.length > 0) && (
                          <ResponseSummary
                            answerSummary={summaryDupesExplanation ? "" : answerSummary}
                            followUpSuggestions={followUps}
                            onFollowUpClick={(text) => {
                              setQuery(text);
                              queryInputRef.current?.focus();
                            }}
                          />
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        ))}

            {error && (
              <Alert variant="destructive" className="rounded-lg">
                <AlertCircle className="size-4" />
                <AlertTitle>Something went wrong</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Fixed bottom bar — only visible when messages exist */}
          <div className="fixed bottom-0 left-[var(--sidebar-width)] right-0 z-40 border-t border-border/80 bg-background/92 px-4 py-3 shadow-lg sm:px-6 sm:py-3.5 backdrop-blur transition-[left] duration-200 ease-out supports-[backdrop-filter]:bg-background/78">
            <div className="mx-auto max-w-4xl space-y-2">
              {sourceOptions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 px-1">
                  <label className="text-[12px] font-medium text-foreground/80">
                    Data source
                  </label>
                  <Select
                    value={selectedDataSourceId}
                    onValueChange={(v) => v && setSelectedDataSourceId(v)}
                    disabled={loading}
                  >
                    <SelectTrigger className="h-8 max-w-[min(100%,28rem)] text-[13px]">
                      <SelectValue>{selectedSourceLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {sourceOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id} label={o.label} className="text-[13px]">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <form
                onSubmit={handleSubmit}
                className="flex items-center gap-2 rounded-2xl border border-border/80 bg-card/78 p-2.5 shadow-sm transition-[border-color,box-shadow,background-color] focus-within:border-primary/45 focus-within:bg-card focus-within:ring-2 focus-within:ring-primary/20"
              >
                <Popover open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 shrink-0 rounded-xl text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      >
                        <Sparkles className="size-4" aria-hidden />
                        <span className="sr-only">Suggested questions</span>
                      </Button>
                    }
                  />
                  <PopoverContent side="top" align="start" className="w-80">
                    <p className="text-xs font-semibold text-foreground">Questions you might ask</p>
                    {suggestedLoading ? (
                      <div className="mt-1.5 space-y-1.5">
                        {[0, 1, 2, 3].map((i) => (
                          <Skeleton key={i} className="h-7 w-full rounded-lg" />
                        ))}
                      </div>
                    ) : suggestedQuestions.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {suggestedQuestions.map((q, i) => (
                          <li key={`${i}-${q.slice(0, 64)}`}>
                            <button
                              type="button"
                              onClick={() => {
                                requestComposerQuery(q);
                                setSuggestionsOpen(false);
                              }}
                              className="w-full rounded-lg border border-transparent px-2.5 py-2 text-left text-[12px] leading-snug text-foreground transition-[border-color,background-color,color] hover:border-border/65 hover:bg-accent/55 hover:text-accent-foreground"
                            >
                              {q}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">No suggestions available.</p>
                    )}
                  </PopoverContent>
                </Popover>
                <Input
                  ref={queryInputRef}
                  placeholder="Ask anything about your data…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={loading}
                  className="min-h-[48px] flex-1 border-0 bg-transparent px-3 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Button
                  type="submit"
                  disabled={loading}
                  size="icon"
                  className="size-12 shrink-0 cursor-pointer rounded-xl"
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Send className="size-4" aria-hidden />
                  )}
                  <span className="sr-only">Send</span>
                </Button>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
