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
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CONVERSATIONS_UI_MAX, useChat } from "@/contexts/ChatContext";
import { useAppMainHeader } from "@/contexts/AppMainHeaderContext";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

const SIDEBAR_STORAGE_KEY = "datapilot_sidebar_collapsed";
const CHATS_SECTION_STORAGE_KEY = "datapilot_sidebar_chats_expanded";
const SIDEBAR_WIDTH_STORAGE_KEY = "datapilot_sidebar_width_px";
const PINNED_CHATS_STORAGE_KEY = "datapilot_sidebar_pinned_chat_ids";
const SIDEBAR_WIDTH_DEFAULT = 224; /* 14rem */
const SIDEBAR_WIDTH_MIN = 192; /* 12rem */
const SIDEBAR_WIDTH_MAX = 384; /* 24rem */
const SIDEBAR_NAV_ITEM_BASE =
  "flex w-full min-h-[36px] items-center gap-3 rounded-xl px-2.5 text-[13px] font-medium transition-colors duration-150";
const SIDEBAR_NAV_ITEM_ACTIVE =
  "bg-sidebar-accent text-sidebar-accent-foreground";
const SIDEBAR_NAV_ITEM_IDLE =
  "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground";
const SIDEBAR_SECTION_LABEL =
  "px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75";

function avatarToneClass(s: string): string {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  return sum % 2 === 0
    ? "bg-primary text-primary-foreground"
    : "bg-secondary text-secondary-foreground";
}

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
  const [pinnedChatIds, setPinnedChatIds] = useState<Set<string>>(new Set());
  const resizeDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const latestWidthRef = useRef(SIDEBAR_WIDTH_DEFAULT);

  useEffect(() => {
    try {
      const v = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (v === "1") setSidebarCollapsed(true);
    } catch { /* ignore */ }
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
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    latestWidthRef.current = sidebarWidthPx;
  }, [sidebarWidthPx]);

  useEffect(() => {
    try {
      const v = localStorage.getItem(CHATS_SECTION_STORAGE_KEY);
      if (v === "1") setChatsExpanded(true);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINNED_CHATS_STORAGE_KEY);
      if (!raw) return;
      const ids = JSON.parse(raw) as string[];
      if (Array.isArray(ids)) setPinnedChatIds(new Set(ids));
    } catch { /* ignore */ }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const toggleChatsSection = useCallback(() => {
    setChatsExpanded((e) => {
      const next = !e;
      try { localStorage.setItem(CHATS_SECTION_STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const togglePinChat = useCallback((chatId: string) => {
    setPinnedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      try {
        localStorage.setItem(PINNED_CHATS_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch { /* ignore */ }
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
    currentConversationId,
    loadConversation,
    conversationsError,
    clearConversationsError,
  } = useChat();

  const userDisplayName = getUserDisplayName(user?.name, user?.email);
  const userInitials = getUserInitials(user?.name, user?.email);
  const avatarColor = avatarToneClass(user?.email ?? user?.name ?? "DP");

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
    const next = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, drag.startW + dx));
    latestWidthRef.current = next;
    setSidebarWidthPx(next);
  }, []);

  const onSidebarResizePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeDragRef.current) {
      try { localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(latestWidthRef.current)); } catch { /* ignore */ }
    }
    resizeDragRef.current = null;
    setIsResizing(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }, []);

  const onSidebarResizePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    resizeDragRef.current = null;
    setIsResizing(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  const pinnedConversations = conversations.filter((c) => pinnedChatIds.has(c.id));
  const recentConversations = conversations.filter((c) => !pinnedChatIds.has(c.id));

  function ChatItemRow({
    id,
    title,
    selected,
    showPinIcon,
  }: {
    id: string;
    title: string;
    selected: boolean;
    showPinIcon: boolean;
  }) {
    const isPinned = pinnedChatIds.has(id);
    return (
      <div className="group relative flex items-center">
        <button
          type="button"
          onClick={() => {
            if (id === currentConversationId && pathname === "/") return;
            loadConversation(id);
            if (pathname !== "/") router.push("/");
          }}
          className={cn(
            "flex flex-1 cursor-pointer items-center rounded-xl px-2.5 py-1.5 text-left text-[12px] transition-colors duration-150",
            selected
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          )}
        >
          <span className="min-w-0 flex-1 truncate pr-1">{title || "Untitled"}</span>
        </button>
        {showPinIcon && (
          <div
            className={cn(
              "absolute inset-y-0 right-0 flex items-center transition-opacity duration-150",
              isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
          >
            <span
              className={cn(
                "pointer-events-none h-full w-6 bg-gradient-to-l",
                selected
                  ? "from-sidebar-accent"
                  : "from-sidebar group-hover:from-sidebar-accent/60"
              )}
              aria-hidden
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePinChat(id);
              }}
              className={cn(
                "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors",
                selected ? "bg-sidebar-accent" : "bg-sidebar group-hover:bg-sidebar-accent/60",
                isPinned
                  ? "text-primary hover:text-primary/80"
                  : "text-muted-foreground hover:text-primary"
              )}
              aria-label={isPinned ? "Unpin chat" : "Pin chat"}
            >
              <Pin
                className={cn(
                  "size-3.5",
                  isPinned && "fill-current"
                )}
                aria-hidden
              />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex h-svh min-h-0 overflow-hidden"
      style={{ ["--sidebar-width" as string]: sidebarWidth } as CSSProperties}
    >
      {/* ── Fixed top chrome header (main content only) ── */}
      <div
        ref={appChromeHeaderRef}
        className={cn(
          "fixed left-[var(--sidebar-width)] right-0 top-0 z-[70] border-b border-border/70 bg-background/92 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-background/78",
          !isResizing && "transition-[left] duration-200 ease-out"
        )}
      >
        <div className="flex min-h-[3.75rem] min-w-0 items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-visible">
            {mainHeader ? (
              <>
                <h1 className="m-0 break-words font-display text-base font-semibold leading-snug tracking-tight text-foreground sm:text-lg sm:leading-snug">
                  {mainHeader.title}
                </h1>
                {mainHeader.description ? (
                  <p className="m-0 text-[12px] leading-snug text-muted-foreground sm:text-[13px] sm:leading-snug">
                    {mainHeader.description}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="m-0 font-display text-sm font-semibold leading-tight text-foreground/45">
                DataPilot
              </p>
            )}
          </div>
          <ThemeToggleButton className="size-9 shrink-0 rounded-xl text-muted-foreground hover:bg-accent hover:text-accent-foreground" />
        </div>
      </div>

      {/* ── Sidebar ── */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 flex h-svh w-[var(--sidebar-width)] flex-col overflow-hidden border-r border-sidebar-border bg-sidebar/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-sidebar/82",
          !isResizing && "transition-[width] duration-200 ease-out"
        )}
      >
        <div
          className={cn(
            "min-h-[var(--app-chrome-header-h,3.75rem)] border-b border-sidebar-border/80",
            sidebarCollapsed ? "px-2 py-2.5" : "px-3 py-2.5"
          )}
        >
          <div className={cn("flex items-center gap-2.5", sidebarCollapsed && "justify-center")}>
            {!sidebarCollapsed && (
              <>
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary/15 text-[12px] font-semibold tracking-wide text-sidebar-primary">
                  DP
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <p className="m-0 truncate font-display text-sm font-semibold tracking-tight text-sidebar-foreground">
                    DataPilot
                  </p>
                  <p className="m-0 truncate text-[11px] text-muted-foreground">Workspace</p>
                </div>
              </>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={toggleSidebar}
                    className="size-9 shrink-0 cursor-pointer rounded-xl text-muted-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground"
                    aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  >
                    {sidebarCollapsed ? (
                      <ChevronRight className="size-5" aria-hidden />
                    ) : (
                      <ChevronLeft className="size-5" aria-hidden />
                    )}
                  </Button>
                }
              />
              <TooltipContent side="right">
                {sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col px-2 py-3">
          <div className="flex min-h-0 flex-1 flex-col gap-3">

            {/* ── Navigation items ── */}
            <div className="shrink-0 space-y-0.5">
              {!sidebarCollapsed ? (
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={handleNewChat}
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
                    className={cn(
                      SIDEBAR_NAV_ITEM_BASE,
                      "justify-start",
                      pathname === "/sources" ? SIDEBAR_NAV_ITEM_ACTIVE : SIDEBAR_NAV_ITEM_IDLE
                    )}
                  >
                    <Database className="size-[1.125rem] shrink-0" aria-hidden />
                    <span className="truncate">Data sources</span>
                  </Link>
                  <Link
                    href="/most-asked"
                    className={cn(
                      SIDEBAR_NAV_ITEM_BASE,
                      "justify-start",
                      pathname === "/most-asked" ? SIDEBAR_NAV_ITEM_ACTIVE : SIDEBAR_NAV_ITEM_IDLE
                    )}
                  >
                    <TrendingUp className="size-[1.125rem] shrink-0" aria-hidden />
                    <span className="truncate">Most asked</span>
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5 px-0.5">
                  {[
                    { href: "/", icon: MessageSquarePlus, label: "New chat", onClick: handleNewChat },
                    { href: "/sources", icon: Database, label: "Data sources" },
                    { href: "/most-asked", icon: TrendingUp, label: "Most asked" },
                    { href: "/chats", icon: MessageSquare, label: "All chats" },
                  ].map(({ href, icon: Icon, label, onClick }) => (
                    <Tooltip key={href}>
                      <TooltipTrigger
                        render={
                          onClick ? (
                            <button
                              type="button"
                              onClick={onClick}
                              className={cn(
                                SIDEBAR_NAV_ITEM_BASE,
                                "cursor-pointer justify-center px-0",
                                pathname === href ? SIDEBAR_NAV_ITEM_ACTIVE : SIDEBAR_NAV_ITEM_IDLE
                              )}
                              aria-label={label}
                            >
                              <Icon className="size-[1.125rem] shrink-0" aria-hidden />
                            </button>
                          ) : (
                            <Link
                              href={href}
                              className={cn(
                                SIDEBAR_NAV_ITEM_BASE,
                                "justify-center px-0",
                                pathname === href ? SIDEBAR_NAV_ITEM_ACTIVE : SIDEBAR_NAV_ITEM_IDLE
                              )}
                              aria-label={label}
                            >
                              <Icon className="size-[1.125rem] shrink-0" aria-hidden />
                            </Link>
                          )
                        }
                      />
                      <TooltipContent side="right">{label}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>

            {/* ── Chat list (scrollable) ── */}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden pr-1" data-scrollbar>

              {/* Sync error alerts */}
              {user && conversationsError && !sidebarCollapsed && (
                <Alert variant="destructive" className="px-3 py-2 text-[12px]">
                  <AlertTitle className="text-[12px] leading-tight">Sync error</AlertTitle>
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
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => clearConversationsError()}
                        className="mx-auto flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-destructive transition-colors hover:bg-destructive/10"
                        aria-label={`Sync error: ${conversationsError}`}
                      >
                        <AlertCircle className="size-5" aria-hidden />
                      </button>
                    }
                  />
                  <TooltipContent side="right">Sync error — tap to dismiss</TooltipContent>
                </Tooltip>
              )}

              {/* Chat list — only shown when sidebar is expanded */}
              {user && !sidebarCollapsed && (
                <div className="mt-2 space-y-3 border-t border-sidebar-border/60 pt-2">

                  {/* Loading skeletons */}
                  {conversations.length === 0 && !conversationsError && (
                    <div className="space-y-1.5 px-1">
                      {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-7 w-full rounded-lg" />
                      ))}
                    </div>
                  )}

                  {/* ── Pinned section ── */}
                  {pinnedConversations.length > 0 && (
                    <div className="space-y-0.5">
                      <p className={SIDEBAR_SECTION_LABEL}>Pinned</p>
                      {pinnedConversations.slice(0, CONVERSATIONS_UI_MAX).map((c) => (
                        <ChatItemRow
                          key={c.id}
                          id={c.id}
                          title={c.title || "Untitled"}
                          selected={c.id === currentConversationId && pathname === "/"}
                          showPinIcon
                        />
                      ))}
                    </div>
                  )}

                  {/* ── Recent Chats section ── */}
                  {recentConversations.length > 0 && (
                    <div className="space-y-0.5">
                      <div className="flex items-center justify-between gap-1.5 px-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">
                          Recent chats
                        </p>
                      </div>
                      {recentConversations.slice(0, CONVERSATIONS_UI_MAX).map((c) => (
                        <ChatItemRow
                          key={c.id}
                          id={c.id}
                          title={c.title || "Untitled"}
                          selected={c.id === currentConversationId && pathname === "/"}
                          showPinIcon
                        />
                      ))}
                    </div>
                  )}

                  {/* All chats collapsible (when no pinned/recent split is needed yet) */}
                  {conversations.length > 0 && pinnedConversations.length === 0 && recentConversations.length === 0 && (
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
                    </>
                  )}

                  {/* Empty state */}
                  {conversations.length === 0 && !conversationsError && (
                    <p className="px-2.5 py-1.5 text-[12px] text-muted-foreground/80">
                      Your conversations will appear here
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </nav>

        {/* ── User profile area ── */}
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
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <div className="cursor-default">
                            <Avatar className="size-9 ring-1 ring-sidebar-border/70">
                              <AvatarFallback className={cn("text-[12px] font-semibold", avatarColor)}>
                                {userInitials}
                              </AvatarFallback>
                            </Avatar>
                          </div>
                        }
                      />
                      <TooltipContent side="right">{user.email}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-9 cursor-pointer rounded-xl text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                            onClick={() => signOut()}
                            aria-label="Sign out"
                          >
                            <LogOut className="size-4" />
                          </Button>
                        }
                      />
                      <TooltipContent side="right">Sign out</TooltipContent>
                    </Tooltip>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 px-1 py-1">
                    <Avatar className="size-9 shrink-0 ring-1 ring-sidebar-border/70">
                      <AvatarFallback className={cn("text-[12px] font-semibold", avatarColor)}>
                        {userInitials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold text-sidebar-foreground">
                        {userDisplayName}
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      className="h-8 shrink-0 cursor-pointer gap-1 rounded-xl px-2 text-[11px] font-medium text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
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
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Link
                            href="/login"
                            className={cn(
                              buttonVariants({ variant: "outline", size: "icon" }),
                              "size-9 rounded-xl border-sidebar-border bg-background/70"
                            )}
                            aria-label="Sign in"
                          >
                            <LogIn className="size-4" />
                          </Link>
                        }
                      />
                      <TooltipContent side="right">Sign in</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Link
                            href="/signup"
                            className={cn(
                              buttonVariants({ variant: "default", size: "icon" }),
                              "size-9 rounded-xl shadow-sm"
                            )}
                            aria-label="Sign up"
                          >
                            <UserPlus className="size-4" />
                          </Link>
                        }
                      />
                      <TooltipContent side="right">Sign up</TooltipContent>
                    </Tooltip>
                  </div>
                ) : (
                  <div className="space-y-2 px-0.5 py-1">
                    <div className="space-y-1 px-0.5">
                      <p className="text-[12px] font-semibold text-sidebar-foreground">
                        Save your conversations
                      </p>
                      <p className="text-[10px] leading-relaxed text-muted-foreground">
                        Keep your history, sync personalized suggestions, and jump back into previous analysis faster.
                      </p>
                    </div>
                    <div className="grid gap-1.5">
                      <Link
                        href="/login"
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

        {/* Resize handle */}
        {!sidebarCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            className={cn(
              "absolute right-0 top-0 z-40 h-full w-3 shrink-0 cursor-col-resize touch-none select-none",
              "hover:bg-primary/10 active:bg-primary/15"
            )}
            onPointerDown={onSidebarResizePointerDown}
            onPointerMove={onSidebarResizePointerMove}
            onPointerUp={onSidebarResizePointerUp}
            onPointerCancel={onSidebarResizePointerCancel}
          >
          </div>
        )}
      </aside>

      {/* ── Main content ── */}
      <main
        className={cn(
          "relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pl-[var(--sidebar-width)]",
          "pt-[var(--app-chrome-header-h,3.75rem)]",
          !isResizing && "transition-[padding-left] duration-200 ease-out"
        )}
      >
        {children}
      </main>
    </div>
  );
}
