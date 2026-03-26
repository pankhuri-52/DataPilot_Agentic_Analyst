"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import {
  MessageSquarePlus,
  MessageSquare,
  Database,
  TrendingUp,
  LogIn,
  UserPlus,
  LogOut,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/contexts/ChatContext";
import { API_BASE, fetchWithRetry } from "@/lib/httpClient";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const SIDEBAR_CHATS_MAX = 12;
const SIDEBAR_STORAGE_KEY = "datapilot_sidebar_collapsed";
const CHATS_SECTION_STORAGE_KEY = "datapilot_sidebar_chats_expanded";
const SIDEBAR_WIDTH_STORAGE_KEY = "datapilot_sidebar_width_px";
const SIDEBAR_WIDTH_DEFAULT = 224; /* 14rem */
const SIDEBAR_WIDTH_MIN = 192; /* 12rem */
const SIDEBAR_WIDTH_MAX = 384; /* 24rem */
const SIDEBAR_NAV_ITEM_BASE =
  "flex w-full min-h-[44px] items-center gap-3 rounded-xl border border-transparent text-sm font-medium transition-all duration-200";
const SIDEBAR_NAV_ITEM_ACTIVE =
  "border-sidebar-border/80 bg-sidebar-accent text-sidebar-foreground shadow-sm";
const SIDEBAR_NAV_ITEM_IDLE =
  "text-muted-foreground hover:border-sidebar-border/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground";
const SIDEBAR_SECTION_LABEL =
  "px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80";
const SIDEBAR_SECTION_CARD =
  "rounded-2xl border border-sidebar-border/70 bg-sidebar-accent/25 p-2 shadow-sm shadow-sidebar-primary/5";

function getUserDisplayName(name?: string, email?: string) {
  const trimmedName = name?.trim();
  if (trimmedName) return trimmedName;
  const emailHandle = email?.split("@")[0]?.trim();
  return emailHandle || "DataPilot user";
}

function getUserInitials(name?: string, email?: string) {
  const source = getUserDisplayName(name, email)
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim();
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length === 0) return "DP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatsExpanded, setChatsExpanded] = useState(false);
  const [sidebarWidthPx, setSidebarWidthPx] = useState(SIDEBAR_WIDTH_DEFAULT);
  const [isResizing, setIsResizing] = useState(false);
  const resizeDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const latestWidthRef = useRef(SIDEBAR_WIDTH_DEFAULT);

  useEffect(() => {
    try {
      const v = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (v === "1") setSidebarCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      if (!raw) return;
      const n = Number.parseInt(raw, 10);
      if (Number.isNaN(n)) return;
      const clamped = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, n));
      setSidebarWidthPx(clamped);
      latestWidthRef.current = clamped;
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    latestWidthRef.current = sidebarWidthPx;
  }, [sidebarWidthPx]);

  useEffect(() => {
    try {
      const v = localStorage.getItem(CHATS_SECTION_STORAGE_KEY);
      if (v === "1") setChatsExpanded(true);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleChatsSection = useCallback(() => {
    setChatsExpanded((e) => {
      const next = !e;
      try {
        localStorage.setItem(CHATS_SECTION_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const { user, loading, signOut, getAccessToken } = useAuth();
  const {
    startNewChat,
    conversations,
    currentConversationId,
    loadConversation,
    conversationsError,
    clearConversationsError,
    requestComposerQuery,
  } = useChat();

  const [mostAskedQuestions, setMostAskedQuestions] = useState<
    { question: string; ask_count: number }[]
  >([]);
  const [mostAskedLoading, setMostAskedLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setMostAskedQuestions([]);
      return;
    }
    const token = getAccessToken();
    if (!token) return;
    let cancelled = false;
    setMostAskedLoading(true);
    fetchWithRetry(
      `${API_BASE}/conversations/frequent-questions?limit=3`,
      { headers: { Authorization: `Bearer ${token}` } },
      { logLabel: "GET /conversations/frequent-questions" }
    )
      .then(async (res) => {
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as {
          questions?: { question?: string; ask_count?: number }[];
        };
        const raw = data.questions ?? [];
        const next = raw
          .map((row) => ({
            question: (row.question ?? "").trim(),
            ask_count: Number(row.ask_count) || 0,
          }))
          .filter((row) => row.question.length > 0);
        setMostAskedQuestions(next);
      })
      .catch(() => {
        if (!cancelled) setMostAskedQuestions([]);
      })
      .finally(() => {
        if (!cancelled) setMostAskedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken]);

  const applyMostAskedQuestion = (question: string) => {
    if (pathname !== "/") router.push("/");
    requestComposerQuery(question);
  };

  const userDisplayName = getUserDisplayName(user?.name, user?.email);
  const userInitials = getUserInitials(user?.name, user?.email);

  const handleNewChat = () => {
    startNewChat();
    if (pathname !== "/") router.push("/");
  };

  const sidebarWidth = sidebarCollapsed ? "3.5rem" : `${sidebarWidthPx}px`;

  const onSidebarResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (sidebarCollapsed) return;
      e.preventDefault();
      e.stopPropagation();
      resizeDragRef.current = { startX: e.clientX, startW: latestWidthRef.current };
      setIsResizing(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [sidebarCollapsed]
  );

  const onSidebarResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const next = Math.min(
      SIDEBAR_WIDTH_MAX,
      Math.max(SIDEBAR_WIDTH_MIN, drag.startW + dx)
    );
    latestWidthRef.current = next;
    setSidebarWidthPx(next);
  }, []);

  const onSidebarResizePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeDragRef.current) {
      try {
        localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(latestWidthRef.current));
      } catch {
        /* ignore */
      }
    }
    resizeDragRef.current = null;
    setIsResizing(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  const onSidebarResizePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    resizeDragRef.current = null;
    setIsResizing(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div
      className="flex min-h-screen"
      style={
        {
          ["--sidebar-width" as string]: sidebarWidth,
        } as CSSProperties
      }
    >
      <aside
        className={cn(
          "fixed left-0 top-0 z-30 flex h-full w-[var(--sidebar-width)] flex-col overflow-hidden border-r border-sidebar-border bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80",
          !isResizing && "transition-[width] duration-200 ease-out"
        )}
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center border-b border-sidebar-border",
            sidebarCollapsed ? "justify-center px-2" : "gap-3 px-3.5"
          )}
        >
          {!sidebarCollapsed && (
            <>
              <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-sidebar-border/80 bg-sidebar-primary/15 text-sm font-semibold tracking-wide text-sidebar-foreground">
                DP
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-base font-semibold tracking-tight text-sidebar-foreground">
                  DataPilot
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  Analytics workspace
                </p>
              </div>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="size-9 shrink-0 cursor-pointer rounded-xl text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="size-5" aria-hidden />
            ) : (
              <ChevronLeft className="size-5" aria-hidden />
            )}
          </Button>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col px-2 py-3">
          <div className="flex-1 space-y-4 overflow-y-auto pr-1" data-scrollbar>
            {!sidebarCollapsed && (
              <div className={cn(SIDEBAR_SECTION_CARD, "space-y-2.5")}>
                <p className={SIDEBAR_SECTION_LABEL}>Workspace</p>
                <button
                  type="button"
                  onClick={handleNewChat}
                  title="New chat"
                  className={cn(
                    SIDEBAR_NAV_ITEM_BASE,
                    "cursor-pointer justify-start px-3.5",
                    pathname === "/" ? SIDEBAR_NAV_ITEM_ACTIVE : SIDEBAR_NAV_ITEM_IDLE
                  )}
                >
                  <MessageSquarePlus className="size-5 shrink-0" aria-hidden />
                  <span className="truncate">New chat</span>
                </button>
                <Link
                  href="/sources"
                  title="Data Sources"
                  className={cn(
                    SIDEBAR_NAV_ITEM_BASE,
                    "justify-start px-3.5",
                    pathname === "/sources" ? SIDEBAR_NAV_ITEM_ACTIVE : SIDEBAR_NAV_ITEM_IDLE
                  )}
                >
                  <Database className="size-5 shrink-0" aria-hidden />
                  <span className="truncate">Data Sources</span>
                </Link>
              </div>
            )}

            {sidebarCollapsed && (
              <div className={cn(SIDEBAR_SECTION_CARD, "space-y-2 p-1.5")}>
                <button
                  type="button"
                  onClick={handleNewChat}
                  title="New chat"
                  className={cn(
                    SIDEBAR_NAV_ITEM_BASE,
                    "cursor-pointer justify-center px-0",
                    pathname === "/" ? SIDEBAR_NAV_ITEM_ACTIVE : SIDEBAR_NAV_ITEM_IDLE
                  )}
                >
                  <MessageSquarePlus className="size-5 shrink-0" aria-hidden />
                </button>
                <Link
                  href="/sources"
                  title="Data Sources"
                  className={cn(
                    SIDEBAR_NAV_ITEM_BASE,
                    "justify-center px-0",
                    pathname === "/sources" ? SIDEBAR_NAV_ITEM_ACTIVE : SIDEBAR_NAV_ITEM_IDLE
                  )}
                >
                  <Database className="size-5 shrink-0" aria-hidden />
                </Link>
              </div>
            )}

            {user && conversationsError && !sidebarCollapsed && (
              <Alert variant="destructive" className="px-3 py-2 text-xs">
                <AlertTitle className="text-xs leading-tight">Chat sync</AlertTitle>
                <AlertDescription className="break-words text-[11px] leading-snug">
                  {conversationsError}
                </AlertDescription>
                <button
                  type="button"
                  onClick={() => clearConversationsError()}
                  className="mt-1 flex items-center gap-1 text-[11px] underline opacity-90 hover:opacity-100"
                >
                  <X className="size-3" aria-hidden />
                  Dismiss
                </button>
              </Alert>
            )}
            {user && conversationsError && sidebarCollapsed && (
              <button
                type="button"
                title={`Chat sync: ${conversationsError}`}
                onClick={() => clearConversationsError()}
                className="mx-auto flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-destructive transition-colors hover:bg-destructive/10"
                aria-label="Chat sync error; dismiss"
              >
                <AlertCircle className="size-5" aria-hidden />
              </button>
            )}

            {user && !sidebarCollapsed && (
              <div className={cn(SIDEBAR_SECTION_CARD, "space-y-2.5")}>
                <div className="flex items-center justify-between gap-2 px-2">
                  <p className={SIDEBAR_SECTION_LABEL}>Recent chats</p>
                  {conversations.length > 0 && (
                    <span className="inline-flex items-center rounded-full border border-sidebar-border/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {Math.min(conversations.length, SIDEBAR_CHATS_MAX)}
                    </span>
                  )}
                </div>
                {conversations.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground/80">No chats yet</p>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={toggleChatsSection}
                      aria-expanded={chatsExpanded}
                      aria-controls="sidebar-chats-list"
                      className={cn(
                        SIDEBAR_NAV_ITEM_BASE,
                        SIDEBAR_NAV_ITEM_IDLE,
                        "cursor-pointer justify-between px-3.5 text-left"
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <MessageSquare className="size-4 shrink-0" aria-hidden />
                        <span className="truncate">All chats</span>
                      </span>
                      <ChevronDown
                        className={cn(
                          "size-4 shrink-0 transition-transform duration-200",
                          !chatsExpanded && "-rotate-90"
                        )}
                        aria-hidden
                      />
                    </button>
                    {chatsExpanded && (
                      <div
                        id="sidebar-chats-list"
                        className="min-h-[2rem] max-h-56 space-y-1 overflow-y-auto pr-1"
                        data-scrollbar
                      >
                        {conversations.slice(0, SIDEBAR_CHATS_MAX).map((c) => {
                          const selected = c.id === currentConversationId && pathname === "/";
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                if (c.id === currentConversationId && pathname === "/") return;
                                loadConversation(c.id);
                                if (pathname !== "/") router.push("/");
                              }}
                              className={cn(
                                "flex w-full cursor-pointer items-center rounded-xl border border-transparent px-3 py-2.5 text-left text-xs transition-all duration-200",
                                selected
                                  ? "border-sidebar-border/80 bg-sidebar-accent text-sidebar-foreground shadow-sm"
                                  : "text-muted-foreground hover:border-sidebar-border/70 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground"
                              )}
                              title={c.title || "Untitled"}
                            >
                              <span className="truncate">{c.title || "Untitled"}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {user && sidebarCollapsed && (
              <div className={cn(SIDEBAR_SECTION_CARD, "space-y-2 p-1.5")}>
                <Link
                  href="/chats"
                  title="All chats"
                  className={cn(
                    SIDEBAR_NAV_ITEM_BASE,
                    "justify-center px-0",
                    pathname === "/chats" ? SIDEBAR_NAV_ITEM_ACTIVE : SIDEBAR_NAV_ITEM_IDLE
                  )}
                >
                  <MessageSquare className="size-5 shrink-0" aria-hidden />
                </Link>
                <button
                  type="button"
                  title="Most Asked — expand sidebar to pick a question"
                  onClick={() => {
                    if (sidebarCollapsed) toggleSidebar();
                  }}
                  className={cn(
                    SIDEBAR_NAV_ITEM_BASE,
                    SIDEBAR_NAV_ITEM_IDLE,
                    "cursor-pointer justify-center px-0"
                  )}
                  aria-label="Most Asked; expand sidebar"
                >
                  <TrendingUp className="size-5 shrink-0" aria-hidden />
                </button>
              </div>
            )}

            {user && !sidebarCollapsed && (
              <div className={cn(SIDEBAR_SECTION_CARD, "space-y-2.5")}>
                <div className="flex items-center gap-3 px-3 py-1">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-sidebar-primary/12 text-sidebar-foreground">
                    <TrendingUp className="size-4 shrink-0" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-sidebar-foreground">Most Asked</p>
                    <p className="text-[11px] text-muted-foreground">Quick ways back into your analysis</p>
                  </div>
                </div>
                {mostAskedLoading && (
                  <p className="px-3 pb-1 text-xs text-muted-foreground">Loading ideas…</p>
                )}
                {!mostAskedLoading && mostAskedQuestions.length === 0 && (
                  <p className="px-3 pb-1 text-xs text-muted-foreground/80">No questions yet</p>
                )}
                {!mostAskedLoading &&
                  mostAskedQuestions.length > 0 &&
                  mostAskedQuestions.map((item) => (
                    <button
                      key={item.question}
                      type="button"
                      onClick={() => applyMostAskedQuestion(item.question)}
                      className="flex w-full cursor-pointer rounded-xl border border-transparent px-3 py-2.5 text-left text-xs text-muted-foreground transition-all duration-200 hover:border-sidebar-border/70 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground"
                      title={item.question}
                    >
                      <span className="line-clamp-3">{item.question}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </nav>
        <div
          className={cn(
            "shrink-0 border-t border-sidebar-border",
            sidebarCollapsed ? "p-2" : "p-3"
          )}
        >
          {!loading && (
            <>
              {user ? (
                sidebarCollapsed ? (
                  <div className="flex flex-col items-center gap-2">
                    <div
                      className="flex size-11 items-center justify-center rounded-2xl border border-sidebar-border/80 bg-sidebar-primary/15 text-sm font-semibold text-sidebar-foreground shadow-sm"
                      title={user.email}
                    >
                      {userInitials}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      className="size-10 cursor-pointer rounded-xl text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                      title="Sign out"
                      onClick={() => signOut()}
                    >
                      <LogOut className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-sidebar-border/70 bg-sidebar-accent/30 p-3 shadow-sm shadow-sidebar-primary/5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="flex size-11 items-center justify-center rounded-2xl border border-sidebar-border/80 bg-sidebar-primary/15 text-sm font-semibold text-sidebar-foreground">
                          {userInitials}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-sidebar-foreground">
                            {userDisplayName}
                          </p>
                          <p className="truncate text-xs text-muted-foreground" title={user.email}>
                            {user.email}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        className="h-10 shrink-0 cursor-pointer gap-1.5 rounded-xl border border-transparent px-3 text-xs font-medium text-sidebar-foreground hover:border-sidebar-border/70 hover:bg-sidebar-accent/70"
                        title="Sign out"
                        onClick={() => signOut()}
                      >
                        <LogOut className="size-3.5" />
                        Sign out
                      </Button>
                    </div>
                  </div>
                )
              ) : (
                sidebarCollapsed ? (
                  <div className="flex flex-col items-center gap-2">
                    <Link
                      href="/login"
                      title="Sign in"
                      className={cn(
                        buttonVariants({ variant: "outline", size: "icon-lg" }),
                        "size-10 rounded-xl border-sidebar-border bg-background/70"
                      )}
                    >
                      <LogIn className="size-4" />
                    </Link>
                    <Link
                      href="/signup"
                      title="Sign up"
                      className={cn(
                        buttonVariants({ variant: "default", size: "icon-lg" }),
                        "size-10 rounded-xl shadow-sm"
                      )}
                    >
                      <UserPlus className="size-4" />
                    </Link>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-sidebar-border/70 bg-sidebar-accent/30 p-3 shadow-sm shadow-sidebar-primary/5">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-sidebar-foreground">
                        Sign in for saved chats
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Keep your conversation history, sync personalized suggestions, and jump
                        back into previous analysis faster.
                      </p>
                    </div>
                    <div className="mt-3 grid gap-2">
                      <Link
                        href="/login"
                        title="Sign in"
                        className={cn(
                          buttonVariants({ variant: "outline", size: "lg" }),
                          "h-11 justify-start rounded-xl border-sidebar-border bg-background/70 px-3"
                        )}
                      >
                        <LogIn className="mr-2 size-4" />
                        Sign in
                      </Link>
                      <Link
                        href="/signup"
                        title="Sign up"
                        className={cn(
                          buttonVariants({ variant: "default", size: "lg" }),
                          "h-11 justify-start rounded-xl px-3 shadow-sm"
                        )}
                      >
                        <UserPlus className="mr-2 size-4" />
                        Sign up
                      </Link>
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </div>
        {!sidebarCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            title="Drag to resize sidebar"
            className={cn(
              "absolute right-0 top-0 z-40 h-full w-3 shrink-0 cursor-col-resize touch-none select-none",
              "hover:bg-primary/10 active:bg-primary/15"
            )}
            onPointerDown={onSidebarResizePointerDown}
            onPointerMove={onSidebarResizePointerMove}
            onPointerUp={onSidebarResizePointerUp}
            onPointerCancel={onSidebarResizePointerCancel}
          >
            <span
              className="pointer-events-none absolute right-1 top-0 h-full w-px bg-border/80"
              aria-hidden
            />
          </div>
        )}
      </aside>
      <main
        className={cn(
          "min-w-0 flex-1 pl-[var(--sidebar-width)]",
          !isResizing && "transition-[padding-left] duration-200 ease-out"
        )}
      >
        {children}
      </main>
    </div>
  );
}
