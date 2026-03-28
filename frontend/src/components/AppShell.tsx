"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { cn } from "@/lib/utils";
import { appTopHeaderStripClass } from "@/lib/appTopHeaderClasses";
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
  Pin,
  PinOff,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CONVERSATIONS_UI_MAX, useChat } from "@/contexts/ChatContext";
import { useAppMainHeader } from "@/contexts/AppMainHeaderContext";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const SIDEBAR_STORAGE_KEY = "datapilot_sidebar_collapsed";
const CHATS_SECTION_STORAGE_KEY = "datapilot_sidebar_chats_expanded";
const CHATS_PIN_STORAGE_KEY = "datapilot_sidebar_chats_pinned";
const SIDEBAR_WIDTH_STORAGE_KEY = "datapilot_sidebar_width_px";
const SIDEBAR_WIDTH_DEFAULT = 224; /* 14rem */
const SIDEBAR_WIDTH_MIN = 192; /* 12rem */
const SIDEBAR_WIDTH_MAX = 384; /* 24rem */
const SIDEBAR_NAV_ITEM_BASE =
  "flex w-full min-h-[36px] items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-150";
const SIDEBAR_NAV_ITEM_ACTIVE =
  "bg-sidebar-accent text-sidebar-accent-foreground";
const SIDEBAR_NAV_ITEM_IDLE =
  "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground";
const SIDEBAR_SECTION_LABEL =
  "px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75";

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
  const [chatsPinned, setChatsPinned] = useState(false);
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

  useEffect(() => {
    try {
      const v = localStorage.getItem(CHATS_PIN_STORAGE_KEY);
      if (v === "1") setChatsPinned(true);
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

  const toggleChatsPinned = useCallback(() => {
    setChatsPinned((p) => {
      const next = !p;
      try {
        localStorage.setItem(CHATS_PIN_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const { user, loading, signOut } = useAuth();
  const { mainHeader } = useAppMainHeader();
  const appChromeHeaderRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = appChromeHeaderRef.current;
    if (!el) return;
    const root = document.documentElement;
    const sync = () => {
      const h = el.getBoundingClientRect().height;
      root.style.setProperty("--app-chrome-header-h", `${Math.round(h)}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--app-chrome-header-h");
    };
  }, []);
  const {
    startNewChat,
    conversations,
    conversationsTotal,
    currentConversationId,
    loadConversation,
    conversationsError,
    clearConversationsError,
  } = useChat();

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
      className="flex h-svh min-h-0 overflow-hidden"
      style={
        {
          ["--sidebar-width" as string]: sidebarWidth,
        } as CSSProperties
      }
    >
      <div
        ref={appChromeHeaderRef}
        className={cn(
          "fixed left-0 right-0 top-0 z-[70] grid items-stretch",
          appTopHeaderStripClass
        )}
        style={{
          gridTemplateColumns: "var(--sidebar-width) minmax(0, 1fr)",
        }}
      >
        <div
          className={cn(
            "flex min-w-0 border-r [border-right-color:var(--app-header-strip-border)]",
            sidebarCollapsed
              ? "items-center justify-center px-2 py-2.5"
              : "items-start gap-3 px-3.5 py-2.5"
          )}
        >
          {!sidebarCollapsed && (
            <>
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/18 text-[12px] font-semibold tracking-wide text-foreground dark:bg-primary-foreground/12">
                DP
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
                <p className="m-0 truncate font-display text-sm font-semibold leading-tight tracking-tight text-foreground">
                  DataPilot
                </p>
                <p className="m-0 truncate text-[12px] leading-snug text-foreground/90">
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
            className={cn(
              "size-9 shrink-0 cursor-pointer rounded-lg text-foreground/85 hover:bg-primary-foreground/20 hover:text-foreground dark:hover:bg-primary-foreground/15",
              !sidebarCollapsed && "mt-0.5"
            )}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="size-5" aria-hidden />
            ) : (
              <ChevronLeft className="size-5" aria-hidden />
            )}
          </Button>
        </div>
        <div className="flex min-w-0 items-start justify-between gap-3 px-3 py-2.5 sm:px-6">
          <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-visible py-0.5">
            {mainHeader ? (
              <>
                <h1 className="m-0 break-words font-display text-base font-semibold leading-snug tracking-tight text-foreground sm:text-lg sm:leading-snug">
                  {mainHeader.title}
                </h1>
                {mainHeader.description ? (
                  <p className="m-0 text-[12px] leading-snug text-foreground/90 sm:text-[13px] sm:leading-snug">
                    {mainHeader.description}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="m-0 font-display text-sm font-semibold leading-tight text-foreground/40">
                DataPilot
              </p>
            )}
          </div>
          <ThemeToggleButton className="mt-0.5 size-9 shrink-0 text-foreground/85 hover:bg-primary-foreground/20 hover:text-foreground dark:text-foreground/90 dark:hover:bg-primary-foreground/15" />
        </div>
      </div>

      <aside
        className={cn(
          "fixed left-0 z-30 flex w-[var(--sidebar-width)] flex-col overflow-hidden border-r border-sidebar-border bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80",
          "top-[max(5.25rem,var(--app-chrome-header-h))] h-[calc(100svh-max(5.25rem,var(--app-chrome-header-h)))]",
          !isResizing && "transition-[width] duration-200 ease-out"
        )}
      >
        <nav className="flex min-h-0 flex-1 flex-col px-2 py-3">
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="shrink-0 space-y-0.5">
              {!sidebarCollapsed && (
                <div className="space-y-0.5">
                  <p className={SIDEBAR_SECTION_LABEL}>Workspace</p>
                  <button
                    type="button"
                    onClick={handleNewChat}
                    title="New chat"
                    className={cn(
                      SIDEBAR_NAV_ITEM_BASE,
                      "cursor-pointer justify-start",
                      pathname === "/" ? SIDEBAR_NAV_ITEM_ACTIVE : SIDEBAR_NAV_ITEM_IDLE
                    )}
                  >
                    <MessageSquarePlus className="size-[1.125rem] shrink-0" aria-hidden />
                    <span className="truncate">New chat</span>
                  </button>
                  <Link
                    href="/sources"
                    title="Data Sources"
                    className={cn(
                      SIDEBAR_NAV_ITEM_BASE,
                      "justify-start",
                      pathname === "/sources" ? SIDEBAR_NAV_ITEM_ACTIVE : SIDEBAR_NAV_ITEM_IDLE
                    )}
                  >
                    <Database className="size-[1.125rem] shrink-0" aria-hidden />
                    <span className="truncate">Data Sources</span>
                  </Link>
                  <Link
                    href="/most-asked"
                    title="Most Asked"
                    className={cn(
                      SIDEBAR_NAV_ITEM_BASE,
                      "justify-start",
                      pathname === "/most-asked"
                        ? SIDEBAR_NAV_ITEM_ACTIVE
                        : SIDEBAR_NAV_ITEM_IDLE
                    )}
                  >
                    <TrendingUp className="size-[1.125rem] shrink-0" aria-hidden />
                    <span className="truncate">Most Asked</span>
                  </Link>
                </div>
              )}

              {sidebarCollapsed && (
                <div className="flex flex-col gap-0.5 px-0.5">
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
                    <MessageSquarePlus className="size-[1.125rem] shrink-0" aria-hidden />
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
                    <Database className="size-[1.125rem] shrink-0" aria-hidden />
                  </Link>
                  <Link
                    href="/most-asked"
                    title="Most Asked"
                    className={cn(
                      SIDEBAR_NAV_ITEM_BASE,
                      "justify-center px-0",
                      pathname === "/most-asked"
                        ? SIDEBAR_NAV_ITEM_ACTIVE
                        : SIDEBAR_NAV_ITEM_IDLE
                    )}
                  >
                    <TrendingUp className="size-[1.125rem] shrink-0" aria-hidden />
                  </Link>
                  <Link
                    href="/chats"
                    title="All chats"
                    className={cn(
                      SIDEBAR_NAV_ITEM_BASE,
                      "justify-center px-0",
                      pathname === "/chats" ? SIDEBAR_NAV_ITEM_ACTIVE : SIDEBAR_NAV_ITEM_IDLE
                    )}
                  >
                    <MessageSquare className="size-[1.125rem] shrink-0" aria-hidden />
                  </Link>
                </div>
              )}
            </div>

            <div
              className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
              data-scrollbar
            >
              {user && conversationsError && !sidebarCollapsed && (
                <Alert variant="destructive" className="px-3 py-2 text-[12px]">
                  <AlertTitle className="text-[12px] leading-tight">Chat sync</AlertTitle>
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
                <div className="mt-2 space-y-0.5 border-t border-sidebar-border/60 pt-2">
                  <div className="flex items-center justify-between gap-1.5 px-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">
                      {chatsPinned ? "Recent chats" : "Chats"}
                    </p>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {conversationsTotal > 0 && (
                        <span className="inline-flex items-center rounded-full border border-sidebar-border/70 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                          {conversationsTotal}
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={toggleChatsPinned}
                        className="size-8 cursor-pointer rounded-lg text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                        title={
                          chatsPinned
                            ? "Use collapsible chat list"
                            : "Keep chat list always visible"
                        }
                        aria-label={
                          chatsPinned
                            ? "Use collapsible chat list"
                            : "Keep chat list always visible"
                        }
                      >
                        {chatsPinned ? (
                          <PinOff className="size-3.5" aria-hidden />
                        ) : (
                          <Pin className="size-3.5" aria-hidden />
                        )}
                      </Button>
                    </div>
                  </div>
                  {conversations.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-[12px] text-muted-foreground/80">
                      No chats yet
                    </p>
                  ) : chatsPinned ? (
                    <div id="sidebar-chats-list" className="space-y-0.5 pr-0.5">
                      {conversations.slice(0, CONVERSATIONS_UI_MAX).map((c) => {
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
                              "flex w-full cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors duration-150",
                              selected
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                            )}
                            title={c.title || "Untitled"}
                          >
                            <span className="truncate">{c.title || "Untitled"}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={toggleChatsSection}
                        aria-expanded={chatsExpanded}
                        aria-controls="sidebar-chats-list-collapsible"
                        className={cn(
                          SIDEBAR_NAV_ITEM_BASE,
                          SIDEBAR_NAV_ITEM_IDLE,
                          "cursor-pointer justify-between text-left"
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <MessageSquare className="size-[1.125rem] shrink-0" aria-hidden />
                          <span className="truncate">All chats</span>
                        </span>
                        <ChevronDown
                          className={cn(
                            "size-3.5 shrink-0 transition-transform duration-200",
                            !chatsExpanded && "-rotate-90"
                          )}
                          aria-hidden
                        />
                      </button>
                      {chatsExpanded && (
                        <div
                          id="sidebar-chats-list-collapsible"
                          className="min-h-[2rem] space-y-0.5 pr-0.5"
                        >
                          {conversations.slice(0, CONVERSATIONS_UI_MAX).map((c) => {
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
                                  "flex w-full cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors duration-150",
                                  selected
                                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
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
            </div>
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
                      className="flex size-10 items-center justify-center rounded-lg bg-sidebar-primary/12 text-[12px] font-semibold text-sidebar-primary"
                      title={user.email}
                    >
                      {userInitials}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      className="size-9 cursor-pointer rounded-lg text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                      title="Sign out"
                      onClick={() => signOut()}
                    >
                      <LogOut className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 px-1 py-1">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary/12 text-[12px] font-semibold text-sidebar-primary">
                      {userInitials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold text-sidebar-foreground">
                        {userDisplayName}
                      </p>
                      <p
                        className="truncate text-[10px] text-muted-foreground"
                        title={user.email}
                      >
                        {user.email}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      className="h-8 shrink-0 cursor-pointer gap-1 rounded-lg px-2 text-[11px] font-medium text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                      title="Sign out"
                      onClick={() => signOut()}
                    >
                      <LogOut className="size-3.5" />
                      <span className="hidden min-[280px]:inline">Sign out</span>
                    </Button>
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
                  <div className="space-y-2 px-0.5 py-1">
                    <div className="space-y-1 px-0.5">
                      <p className="text-[12px] font-semibold text-sidebar-foreground">
                        Sign in for saved chats
                      </p>
                      <p className="text-[10px] leading-relaxed text-muted-foreground">
                        Keep your conversation history, sync personalized suggestions, and jump
                        back into previous analysis faster.
                      </p>
                    </div>
                    <div className="grid gap-1.5">
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
          "relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pl-[var(--sidebar-width)]",
          /* Keep content below fixed chrome; max() guards if measured height lags wrapping/fonts */
          "pt-[max(5.25rem,var(--app-chrome-header-h))]",
          !isResizing && "transition-[padding-left] duration-200 ease-out"
        )}
      >
        {children}
      </main>
    </div>
  );
}
