"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Send, Loader2 } from "lucide-react";
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
  } = useChat();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  async function handleContinue(message: Message, approved = true) {
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

    try {
      const res = await fetchWithRetry(
        `${API_BASE}/ask/continue`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            thread_id: threadId,
            conversation_id: continueConvId,
            approved,
            original_query: precedingUserContent(convKey, assistantMessageId) || undefined,
          }),
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
      <div className="space-y-6 pb-24">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground">
              Hey {displayName}, ask me a question and I&apos;ll help you find answers from our database.
            </p>
            <p className="mt-1 text-xs text-muted-foreground/80">
              Try: &quot;What were total sales by region last month?&quot;
            </p>
            {!user && (
              <p className="mt-3 text-xs text-amber-600 dark:text-amber-500">
                Sign in to save your chat history and access it later.
              </p>
            )}
          </div>
        )}

        {messages.map((message) => (
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
                          The run pauses here until you approve running the query against your
                          warehouse. Review SQL and estimated cost (if shown), then choose Yes or
                          No.
                        </AlertDescription>
                      </Alert>
                      <div className="rounded-lg border border-primary/30 bg-accent/20 p-4 space-y-3">
                        {(message.pendingInterrupt.reason === "execute_query" ||
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
                          />
                        )}
                        {showOutcomeCard && (
                          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                            {res.chart_spec?.title && (
                              <p className="text-sm font-medium">{res.chart_spec.title}</p>
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
                            answerSummary={answerSummary}
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

      <div className="fixed bottom-0 left-[var(--sidebar-width)] right-0 z-20 border-t border-border bg-background/95 px-4 py-4 backdrop-blur transition-[left] duration-200 ease-out supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-4xl">
          <form
            onSubmit={handleSubmit}
            className="flex gap-2 rounded-xl border border-border bg-muted/30 p-2 transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20"
          >
            <Input
              ref={queryInputRef}
              placeholder="Ask a question about your data..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={loading}
              className="min-h-[44px] flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <Button
              type="submit"
              disabled={loading}
              size="icon"
              className="size-11 shrink-0 cursor-pointer rounded-lg"
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
