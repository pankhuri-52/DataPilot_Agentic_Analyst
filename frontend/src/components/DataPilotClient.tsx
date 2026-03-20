"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Send, Loader2 } from "lucide-react";
import { StepLoader } from "./StepLoader";
import { PlanCard } from "./PlanCard";
import { ArtifactCard } from "./ArtifactCard";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  useChat,
  type Conversation,
  type Message,
  conversationMessagesKey,
} from "@/contexts/ChatContext";

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
  trace?: TraceEntry[];
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
  if (o.metrics && Array.isArray(o.metrics)) {
    return {
      metrics: o.metrics,
      dimensions: (o.dimensions as string[]) ?? [],
      filters: (o.filters as Record<string, unknown>) ?? {},
      is_valid: o.is_valid,
    };
  }
  if (o.clarifying_questions && Array.isArray(o.clarifying_questions)) {
    return {
      is_valid: false,
      clarifying_questions: o.clarifying_questions,
      query_scope: typeof o.query_scope === "string" ? o.query_scope : undefined,
    };
  }
  return undefined;
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
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
      const res = await fetch(`${API_BASE}/ask/continue`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          thread_id: threadId,
          conversation_id: continueConvId,
          approved,
          original_query: precedingUserContent(convKey, assistantMessageId) || undefined,
        }),
      });

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
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = query.trim();
    if (!text) return;

    const token = getAccessToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let streamConversationId = currentConversationId;
    if (user && token && !streamConversationId) {
      const title = text.length > 80 ? `${text.slice(0, 80)}…` : text;
      try {
        const cr = await fetch(`${API_BASE}/conversations`, {
          method: "POST",
          headers,
          body: JSON.stringify({ title }),
        });
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
      const res = await fetch(`${API_BASE}/ask/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: text,
          conversation_id: streamConversationId || undefined,
        }),
      });

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

                  {message.pendingInterrupt && (
                    <div className="space-y-4">
                      {message.plan && <PlanCard plan={message.plan} />}
                      {(message.liveTrace ?? []).length > 0 && (
                        <StepLoader liveTrace={message.liveTrace ?? []} isLoading={false} />
                      )}
                      <div className="rounded-lg border border-primary/30 bg-accent/20 p-4 space-y-3">
                        {message.pendingInterrupt.reason === "approve_tables" && (
                          <>
                            <p className="text-xs font-medium">Tables to be used:</p>
                            <ul className="text-xs text-muted-foreground list-disc list-inside">
                              {((message.pendingInterrupt.tables_used ?? message.pendingInterrupt.data?.tables ?? []) as string[]).map((t) => (
                                <li key={t}>{t}</li>
                              ))}
                            </ul>
                            <p className="text-xs text-muted-foreground">Proceed with these tables?</p>
                          </>
                        )}
                        {message.pendingInterrupt.reason === "execute_query" && (
                          <>
                            <p className="text-xs font-medium">Query ready to execute</p>
                            {message.pendingInterrupt.sql && (
                              <pre className="text-[11px] overflow-x-auto rounded bg-muted/50 p-2 max-h-32">
                                {message.pendingInterrupt.sql}
                              </pre>
                            )}
                            {(message.pendingInterrupt.bytes_scanned != null || message.pendingInterrupt.estimated_cost != null) && (
                              <p className="text-xs text-muted-foreground">
                                {message.pendingInterrupt.bytes_scanned != null &&
                                  `~${(message.pendingInterrupt.bytes_scanned / (1024 * 1024)).toFixed(2)} MB scanned`}
                                {message.pendingInterrupt.estimated_cost != null &&
                                  ` · ~$${message.pendingInterrupt.estimated_cost.toFixed(6)} estimated cost`}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">Execute this query?</p>
                          </>
                        )}
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => message.pendingInterrupt && handleContinue(message, true)}
                          >
                            Yes
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => message.pendingInterrupt && handleContinue(message, false)}
                          >
                            No
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {message.loading && !message.pendingInterrupt && (
                    <div className="space-y-4">
                      {message.plan && (
                        <PlanCard plan={message.plan} />
                      )}
                      <StepLoader
                        liveTrace={message.liveTrace ?? []}
                        isLoading={message.loading}
                      />
                    </div>
                  )}

                  {message.response && !message.loading && (() => {
                    const res = message.response as AskResponse;
                    return (
                    <div className="space-y-4">
                      {(message.plan ?? res?.plan) && (
                        <PlanCard plan={message.plan ?? res?.plan ?? {}} />
                      )}
                      {(res.trace ?? message.liveTrace ?? []).length > 0 && (
                        <StepLoader
                          liveTrace={res.trace ?? message.liveTrace ?? []}
                          isLoading={false}
                        />
                      )}
                      {res.missing_explanation && (
                        <Alert className="rounded-lg">
                          <AlertTitle>Partial data</AlertTitle>
                          <AlertDescription>
                            {res.missing_explanation}
                          </AlertDescription>
                        </Alert>
                      )}
                      {res.results &&
                        res.results.length > 0 && (
                          <ArtifactCard
                            title={
                              res.chart_spec?.title || "Results"
                            }
                            explanation={res.explanation}
                            chartSpec={res.chart_spec}
                            results={res.results}
                            sql={res.sql}
                            dataFeasibility={res.data_feasibility}
                            validationOk={res.validation_ok}
                          />
                        )}
                      {res.results?.length === 0 &&
                        res.explanation && (
                          <div className="rounded-lg border border-border bg-card p-4">
                            <p className="text-sm text-muted-foreground">
                              {res.explanation}
                            </p>
                          </div>
                        )}
                    </div>
                    );
                  })()}

                  {message.error && !message.loading && !message.response && (
                    <div className="space-y-4">
                      {(message.plan ?? extractPlanFromTrace(message.liveTrace ?? [])) && (
                        <PlanCard plan={message.plan ?? extractPlanFromTrace(message.liveTrace ?? []) ?? {}} />
                      )}
                      {message.liveTrace && message.liveTrace.length > 0 && (
                        <StepLoader
                          liveTrace={message.liveTrace}
                          isLoading={false}
                        />
                      )}
                    </div>
                  )}
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

      <div className="fixed bottom-0 left-56 right-0 z-20 border-t border-border bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-4xl">
          <form
            onSubmit={handleSubmit}
            className="flex gap-2 rounded-xl border border-border bg-muted/30 p-2 transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20"
          >
            <Input
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
