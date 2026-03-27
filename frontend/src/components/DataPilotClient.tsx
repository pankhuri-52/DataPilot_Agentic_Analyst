"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Send, Loader2, Sparkles, FileDown } from "lucide-react";
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
import { buildResultPdfBlob, triggerPdfFileDownload } from "@/lib/exportResultPdf";
import { getPdfAnalyticalQuestion } from "@/lib/pdfUserQuestion";
import { formatExecutedAtLabel } from "@/lib/formatExecutedAt";

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
  const { user, getAccessToken } = useAuth();
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
  const [pdfExportingForMessageId, setPdfExportingForMessageId] = useState<string | null>(null);
  const [outcomePdfManual, setOutcomePdfManual] = useState<{
    messageId: string;
    url: string;
    name: string;
  } | null>(null);
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
    return () => {
      if (outcomePdfManual) URL.revokeObjectURL(outcomePdfManual.url);
    };
  }, [outcomePdfManual]);

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
          sources?: { id: string; label: string }[];
        };
        const opts = (data.sources ?? []).map((s) => ({
          id: s.id,
          label: s.label || s.id,
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
    fetchWithRetry(
      `${API_BASE}/conversations/suggested-questions?limit=5&include_kb=true`,
      { headers: { Authorization: `Bearer ${token}` } },
      { logLabel: "GET /conversations/suggested-questions" }
    )
      .then(async (res) => {
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
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestedQuestions([]);
          setSuggestedSource(null);
        }
      })
      .finally(() => {
        if (!cancelled) setSuggestedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken]);

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
          ? { ...m, loading: true, pendingInterrupt: undefined }
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
        { logLabel: "POST /ask/continue (stream)" }
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
                  return { ...m, liveTrace: newTrace };
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
        { logLabel: "POST /ask/stream" }
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

  return (
    <div className="flex flex-1 flex-col min-w-0">
      <div className="space-y-6 pb-28 sm:pb-32">
        {user && messages.length > 0 && (suggestedLoading || suggestedQuestions.length > 0) && (
          <div
            className={cn(
              "sticky top-0 z-10 border-b border-border/50 bg-background/95 px-0 py-2.5 backdrop-blur-sm supports-[backdrop-filter]:bg-background/90",
              "dark:border-border/40"
            )}
          >
            <div className="mx-auto w-full max-w-xl text-left">
              <div className="flex items-start gap-2">
                <Sparkles
                  className="mt-0.5 size-3.5 shrink-0 text-primary"
                  aria-hidden
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-[12px] font-medium text-foreground">
                    {suggestedSource === "generic"
                      ? "Try asking"
                      : "Based on your past questions"}
                  </p>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    {suggestedSource === "generic"
                      ? "Starter questions for this warehouse."
                      : "From your history and similar saved queries, plus fresh AI ideas."}
                  </p>
                </div>
              </div>
              {suggestedLoading && (
                <p className="mt-2 text-[10px] text-muted-foreground">Loading…</p>
              )}
              {!suggestedLoading && suggestedQuestions.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {suggestedQuestions.map((q, i) => (
                    <li key={`${i}-${q.slice(0, 64)}`}>
                      <button
                        type="button"
                        onClick={() => requestComposerQuery(q)}
                        className={cn(
                          "w-full rounded-lg px-2 py-1.5 text-left text-[12px] leading-snug text-foreground",
                          "transition-colors hover:bg-muted/80"
                        )}
                      >
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {messages.length === 0 && (
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-2 py-4 text-center sm:py-6">
            <h2 className="font-display text-sm font-semibold tracking-tight text-foreground sm:text-base">
              {`Hey ${displayName}, what would you like to explore today?`}
            </h2>
            {user ? (
              <>
                <p className="mt-1.5 max-w-lg text-[10px] leading-snug text-muted-foreground sm:text-[11px]">
                  Here are some questions you might want to ask based on your history
                </p>
                {suggestedLoading && (
                  <ul
                    className="mt-3 flex w-full max-w-xl flex-col items-center space-y-1"
                    aria-busy="true"
                    aria-label="Loading suggestions"
                  >
                    {[0, 1, 2].map((i) => (
                      <li key={i} className="w-full max-w-xl">
                        <div
                          className={cn(
                            "mx-auto h-8 w-full max-w-xl rounded-lg bg-muted/40 animate-pulse"
                          )}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {!suggestedLoading && suggestedQuestions.length > 0 && (
                  <ul className="mt-3 flex w-full max-w-xl flex-col items-center space-y-0.5">
                    {suggestedQuestions.map((q, i) => (
                      <li key={`${i}-${q.slice(0, 64)}`} className="w-full max-w-xl">
                        <button
                          type="button"
                          onClick={() => requestComposerQuery(q)}
                          className={cn(
                            "w-full rounded-lg px-3 py-1.5 text-center text-[12px] leading-snug text-foreground",
                            "transition-colors hover:bg-muted/80",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                          )}
                        >
                          {q}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="mt-1.5 max-w-sm text-[10px] text-muted-foreground sm:text-[11px]">
                Sign in to save your chat history and get personalized suggestions.
              </p>
            )}
          </div>
        )}

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
                <div className="rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground">
                  <p className="text-sm leading-relaxed">{message.content}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {message.error && (
                    <Alert variant="destructive" className="rounded-lg">
                      <AlertCircle className="size-4" />
                      <AlertTitle>Error</AlertTitle>
                      <AlertDescription>{message.error}</AlertDescription>
                    </Alert>
                  )}

                  {/* Approval must appear before the long execution plan so users are not stuck waiting */}
                  {message.pendingInterrupt && (
                    <div className="space-y-3">
                      <Alert className="rounded-lg border-primary/40 bg-primary/5">
                        <AlertTitle>Action required</AlertTitle>
                        <AlertDescription>
                          {(message.pendingInterrupt.reason === "query_cache_hit" ||
                            message.pendingInterrupt.data?.reason === "query_cache_hit")
                            ? "We found a similar question you asked before. Review the saved SQL and sample results, then choose Re-run (full new analysis) or Adapt (re-run the saved query on your warehouse)."
                            : "The run pauses here until you approve running the query against your warehouse. Review SQL and estimated cost (if shown), then choose Yes or No."}
                        </AlertDescription>
                      </Alert>
                      <div className="rounded-lg border border-primary/30 bg-accent/20 p-4 space-y-3">
                        {(message.pendingInterrupt.reason === "query_cache_hit" ||
                          message.pendingInterrupt.data?.reason === "query_cache_hit") ? (
                          <>
                            <p className="text-xs font-medium">Similar question in your knowledge base</p>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              We&apos;ve answered something similar before. Here&apos;s the cached SQL
                              + result sample
                              {(() => {
                                const iso =
                                  (message.pendingInterrupt.data?.executed_at as string | undefined) ||
                                  "";
                                const label = formatExecutedAtLabel(iso);
                                return label ? ` from ${label}` : "";
                              })()}
                              . <span className="font-medium">Re-run</span> runs the full analysis
                              pipeline; <span className="font-medium">Adapt</span> reuses this SQL
                              against your warehouse (skips planner / discovery / optimizer).
                            </p>
                            {(() => {
                              const intr = message.pendingInterrupt!;
                              const matched =
                                (intr.data?.matched_question as string | undefined)?.trim() || "";
                              const sim = intr.data?.similarity as number | undefined;
                              return (
                                <>
                                  {matched && (
                                    <p className="text-[11px] text-muted-foreground">
                                      Matched question: <span className="text-foreground">{matched}</span>
                                      {sim != null && !Number.isNaN(Number(sim)) && (
                                        <span className="ml-2">· similarity {(Number(sim)).toFixed(2)}</span>
                                      )}
                                    </p>
                                  )}
                                </>
                              );
                            })()}
                            {(() => {
                              const intr = message.pendingInterrupt!;
                              const sql =
                                intr.sql ?? (intr.data?.sql as string | undefined);
                              const preview = intr.data?.result_preview as
                                | { rows?: Record<string, unknown>[]; row_count?: number }
                                | undefined;
                              const rows = Array.isArray(preview?.rows) ? preview.rows : [];
                              const rowCount =
                                typeof preview?.row_count === "number" ? preview.row_count : rows.length;
                              return (
                                <>
                                  {sql && (
                                    <pre className="text-[11px] overflow-x-auto rounded bg-muted/50 p-2 max-h-32">
                                      {sql}
                                    </pre>
                                  )}
                                  {rows.length > 0 && (
                                    <div className="space-y-1">
                                      <p className="text-[11px] text-muted-foreground">
                                        Sample results ({rowCount} row{rowCount === 1 ? "" : "s"} total)
                                      </p>
                                      <div className="max-h-28 overflow-auto rounded border border-border/60 text-[10px]">
                                        <table className="w-full border-collapse">
                                          <thead>
                                            <tr className="border-b bg-muted/30">
                                              {Object.keys(rows[0]).map((k) => (
                                                <th key={k} className="px-2 py-1 text-left font-medium">
                                                  {k}
                                                </th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {rows.slice(0, 5).map((row, i) => (
                                              <tr key={i} className="border-b border-border/40">
                                                {Object.values(row).map((v, j) => (
                                                  <td key={j} className="px-2 py-0.5 max-w-[120px] truncate">
                                                    {v === null || v === undefined ? "" : String(v)}
                                                  </td>
                                                ))}
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  )}
                                  <div className="flex flex-wrap gap-2 pt-1">
                                    <Button
                                      size="sm"
                                      className="cursor-pointer"
                                      onClick={() =>
                                        message.pendingInterrupt &&
                                        handleContinue(message, { queryCache: "full_pipeline" })
                                      }
                                    >
                                      Re-run
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      className="cursor-pointer"
                                      onClick={() =>
                                        message.pendingInterrupt &&
                                        handleContinue(message, { queryCache: "use_cached_sql" })
                                      }
                                    >
                                      Adapt
                                    </Button>
                                  </div>
                                </>
                              );
                            })()}
                          </>
                        ) : (message.pendingInterrupt.reason === "execute_query" ||
                          message.pendingInterrupt.data?.reason === "execute_query") ? (
                          <>
                            <p className="text-xs font-medium">Query ready to execute</p>
                            {(() => {
                              const intr = message.pendingInterrupt!;
                              const sql =
                                intr.sql ?? (intr.data?.sql as string | undefined);
                              const bytes =
                                intr.bytes_scanned ??
                                (intr.data?.bytes_scanned as number | undefined);
                              const cost =
                                intr.estimated_cost ??
                                (intr.data?.estimated_cost as number | undefined);
                              const dialect = intr.data?.dialect as string | undefined;
                              return (
                                <>
                                  {!sql && (
                                    <p className="text-xs text-amber-700 dark:text-amber-500">
                                      SQL preview was not included in the response. You can still
                                      try Yes to continue, or No to cancel.
                                    </p>
                                  )}
                                  {sql && (
                                    <pre className="text-[11px] overflow-x-auto rounded bg-muted/50 p-2 max-h-32">
                                      {sql}
                                    </pre>
                                  )}
                                  {dialect === "postgres" &&
                                    bytes == null &&
                                    cost == null && (
                                      <p className="text-xs text-muted-foreground">
                                        Cost and bytes estimates are available for BigQuery only.
                                      </p>
                                    )}
                                  {(bytes != null || cost != null) && (
                                    <p className="text-xs text-muted-foreground">
                                      {bytes != null &&
                                        `~${(bytes / (1024 * 1024)).toFixed(2)} MB scanned`}
                                      {cost != null && ` · ~$${cost.toFixed(6)} estimated cost`}
                                    </p>
                                  )}
                                  <p className="text-xs text-muted-foreground">
                                    Execute this query?
                                  </p>
                                </>
                              );
                            })()}
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Confirmation required to continue.
                          </p>
                        )}
                        {!(
                          message.pendingInterrupt.reason === "query_cache_hit" ||
                          message.pendingInterrupt.data?.reason === "query_cache_hit"
                        ) && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="cursor-pointer"
                              onClick={() => message.pendingInterrupt && handleContinue(message, true)}
                            >
                              Yes
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="cursor-pointer"
                              onClick={() => message.pendingInterrupt && handleContinue(message, false)}
                            >
                              No
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
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
                          <ExecutionPlanPanel
                            key={message.id}
                            plan={effectivePlan}
                            liveTrace={trace}
                            isLoading={Boolean(message.loading && !message.pendingInterrupt)}
                            isTurnComplete={Boolean(res && !message.loading)}
                            pendingInterrupt={
                              message.pendingInterrupt
                                ? {
                                    reason: message.pendingInterrupt.reason,
                                    data: message.pendingInterrupt.data,
                                  }
                                : undefined
                            }
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
                          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium">Outcome</p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="cursor-pointer gap-1.5"
                                disabled={pdfExportingForMessageId === message.id}
                                onClick={() => {
                                  const priorQ = getPdfAnalyticalQuestion(messages, msgIndex);
                                  setPdfExportingForMessageId(message.id);
                                  void (async () => {
                                    try {
                                      const { blob, filename } = await buildResultPdfBlob({
                                        userQuestion: priorQ,
                                        reportTitle: res.chart_spec?.title || "Results",
                                        answerSummary: summaryDupesExplanation ? "" : answerSummary,
                                        explanation: explanationText,
                                        followUpSuggestions: followUps,
                                        missingExplanation:
                                          typeof res.missing_explanation === "string"
                                            ? res.missing_explanation
                                            : undefined,
                                        emptyResultReason: emptyReason,
                                        sql: typeof res.sql === "string" ? res.sql : undefined,
                                        results: [],
                                      });
                                      setOutcomePdfManual((prev) => {
                                        if (prev) URL.revokeObjectURL(prev.url);
                                        return {
                                          messageId: message.id,
                                          url: URL.createObjectURL(blob),
                                          name: filename,
                                        };
                                      });
                                      triggerPdfFileDownload(blob, filename);
                                    } catch (e) {
                                      console.error("Outcome PDF export failed", e);
                                    } finally {
                                      setPdfExportingForMessageId(null);
                                    }
                                  })();
                                }}
                              >
                                {pdfExportingForMessageId === message.id ? (
                                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                                ) : (
                                  <FileDown className="size-3.5" aria-hidden />
                                )}
                                Download PDF
                              </Button>
                            </div>
                            {outcomePdfManual?.messageId === message.id && (
                              <p className="text-xs text-muted-foreground">
                                No file saved?{" "}
                                <a
                                  href={outcomePdfManual.url}
                                  download={outcomePdfManual.name}
                                  className="font-medium text-primary underline underline-offset-2"
                                >
                                  Download PDF
                                </a>
                              </p>
                            )}
                            {explanationText && (
                              <p className="text-sm text-muted-foreground">{res.explanation}</p>
                            )}
                            {emptyReason && !explanationText && (
                              <p className="text-sm text-muted-foreground">{emptyReason}</p>
                            )}
                          </div>
                        )}
                        {!hasRows &&
                          !showOutcomeCard &&
                          !res.missing_explanation &&
                          (res.validation_ok !== undefined || res.trace) && (
                            <p className="text-sm text-muted-foreground">
                              Run finished. No tabular results were returned—check the execution plan
                              above or try another question.
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
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="fixed bottom-0 left-[var(--sidebar-width)] right-0 z-40 border-border bg-background/95 px-4 py-3 sm:px-6 sm:py-3.5 backdrop-blur transition-[left] duration-200 ease-out supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-4xl space-y-2">
          {sourceOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-1 text-[12px] text-muted-foreground">
              <label htmlFor="datapilot-source" className="font-medium text-foreground/80">
                Data source
              </label>
              <select
                id="datapilot-source"
                value={selectedDataSourceId}
                onChange={(e) => setSelectedDataSourceId(e.target.value)}
                disabled={loading}
                className="max-w-[min(100%,28rem)] cursor-pointer rounded-md border border-border bg-background px-2 py-1.5 text-[13px] text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {sourceOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <form
            onSubmit={handleSubmit}
            className="flex gap-2 rounded-2xl border border-border/80 bg-muted/40 p-2.5 shadow-sm transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20"
          >
            <Input
              ref={queryInputRef}
              placeholder="Ask a question about your data..."
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
    </div>
  );
}
