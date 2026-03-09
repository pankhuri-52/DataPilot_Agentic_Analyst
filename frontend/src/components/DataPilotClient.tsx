"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Send, Loader2, MessageSquarePlus } from "lucide-react";
import { StepLoader } from "./StepLoader";
import { PlanCard } from "./PlanCard";
import { ArtifactCard } from "./ArtifactCard";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

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
  conversation_id?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content?: string;
  loading?: boolean;
  error?: string;
  plan?: Record<string, unknown>;
  liveTrace?: TraceEntry[];
  response?: AskResponse;
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
  return undefined;
}

export function DataPilotClient() {
  const { user, getAccessToken } = useAuth();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchConversations = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch {
      // Ignore
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (user) {
      fetchConversations();
    } else {
      setConversations([]);
      setCurrentConversationId(null);
    }
  }, [user, fetchConversations]);

  const loadConversation = useCallback(
    async (convId: string) => {
      const token = getAccessToken();
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE}/conversations/${convId}/messages`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const msgs = (data.messages || []) as { role: string; content: string; metadata?: Record<string, unknown> }[];
          setMessages(
            msgs.map((m) => {
              const meta = m.metadata || {};
              const response: AskResponse | undefined =
                m.role === "assistant"
                  ? { ...meta, explanation: m.content } as AskResponse
                  : undefined;
              return {
                id: crypto.randomUUID(),
                role: m.role as "user" | "assistant",
                content: m.content,
                response,
              };
            })
          );
          setCurrentConversationId(convId);
        }
      } catch {
        // Ignore
      }
    },
    [getAccessToken]
  );

  const startNewChat = () => {
    setCurrentConversationId(null);
    setMessages([]);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: query.trim(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setQuery("");
    setLoading(true);
    setError(null);

    const assistantMessageId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      loading: true,
      liveTrace: [],
    };
    setMessages((prev) => [...prev, assistantMessage]);

    const token = getAccessToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${API_BASE}/ask/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: query.trim(),
          conversation_id: currentConversationId || undefined,
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
              setMessages((prev) =>
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
              const convId = event.response?.conversation_id;
              if (convId) {
                setCurrentConversationId(convId);
                fetchConversations();
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        loading: false,
                        liveTrace: event.response?.trace ?? m.liveTrace,
                        response: event.response,
                        plan: event.response?.plan ?? m.plan,
                      }
                    : m
                )
              );
            } else if (event.type === "error") {
              setMessages((prev) =>
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
              const convId = event.response?.conversation_id;
              if (convId) {
                setCurrentConversationId(convId);
                fetchConversations();
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        loading: false,
                        liveTrace: event.response?.trace ?? m.liveTrace,
                        response: event.response,
                        plan: event.response?.plan ?? m.plan,
                      }
                    : m
                )
              );
            } else if (event.type === "error") {
              setMessages((prev) =>
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
      setMessages((prev) =>
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

  return (
    <div className="flex flex-1 gap-4">
      {user && (
        <aside className="hidden w-56 shrink-0 flex-col gap-2 md:flex">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start cursor-pointer"
            onClick={startNewChat}
          >
            <MessageSquarePlus className="size-4 mr-2" />
            New chat
          </Button>
          <div className="flex flex-col gap-1 overflow-y-auto max-h-[calc(100vh-12rem)]">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => loadConversation(conv.id)}
                className={cn(
                  "truncate rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                  currentConversationId === conv.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {conv.title || "Untitled"}
              </button>
            ))}
          </div>
        </aside>
      )}
      <div className="flex flex-1 flex-col min-w-0">
      <div className="space-y-6 pb-24">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground">
              Ask a question about your connected data sources.
            </p>
            <p className="mt-1 text-xs text-muted-foreground/80">
              Try: &quot;What were total sales by region last month?&quot;
            </p>
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

                  {message.loading && (
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

                  {message.response && !message.loading && (
                    <div className="space-y-4">
                      {(message.plan ?? message.response?.plan) && (
                        <PlanCard plan={message.plan ?? message.response?.plan ?? {}} />
                      )}
                      {(message.response.trace ?? message.liveTrace ?? []).length > 0 && (
                        <StepLoader
                          liveTrace={message.response.trace ?? message.liveTrace ?? []}
                          isLoading={false}
                        />
                      )}
                      {message.response.missing_explanation && (
                        <Alert className="rounded-lg">
                          <AlertTitle>Partial data</AlertTitle>
                          <AlertDescription>
                            {message.response.missing_explanation}
                          </AlertDescription>
                        </Alert>
                      )}
                      {message.response.results &&
                        message.response.results.length > 0 && (
                          <ArtifactCard
                            title={
                              message.response.chart_spec?.title || "Results"
                            }
                            explanation={message.response.explanation}
                            chartSpec={message.response.chart_spec}
                            results={message.response.results}
                            sql={message.response.sql}
                            dataFeasibility={message.response.data_feasibility}
                            validationOk={message.response.validation_ok}
                          />
                        )}
                      {message.response.results?.length === 0 &&
                        message.response.explanation && (
                          <div className="rounded-lg border border-border bg-card p-4">
                            <p className="text-sm text-muted-foreground">
                              {message.response.explanation}
                            </p>
                          </div>
                        )}
                    </div>
                  )}

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
    </div>
  );
}
