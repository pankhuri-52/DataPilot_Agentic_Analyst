"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import {
  MessageSquarePlus,
  MessageSquare,
  Database,
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
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const SIDEBAR_CHATS_MAX = 12;
const SIDEBAR_STORAGE_KEY = "datapilot_sidebar_collapsed";
const CHATS_SECTION_STORAGE_KEY = "datapilot_sidebar_chats_expanded";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatsExpanded, setChatsExpanded] = useState(false);

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

  const { user, loading, signOut } = useAuth();
  const {
    startNewChat,
    conversations,
    currentConversationId,
    loadConversation,
    conversationsError,
    clearConversationsError,
  } = useChat();

  const handleNewChat = () => {
    startNewChat();
    if (pathname !== "/") router.push("/");
  };

  const sidebarWidth = sidebarCollapsed ? "3.5rem" : "14rem";

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
          "fixed left-0 top-0 z-30 flex h-full w-[var(--sidebar-width)] flex-col border-r border-border bg-sidebar/95 backdrop-blur transition-[width] duration-200 ease-out supports-[backdrop-filter]:bg-sidebar/80 overflow-hidden"
        )}
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border",
            sidebarCollapsed ? "justify-center px-2" : "px-4"
          )}
        >
          {!sidebarCollapsed && (
            <span className="min-w-0 flex-1 truncate font-display text-lg font-semibold tracking-tight text-foreground">
              DataPilot
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="size-9 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="size-5" aria-hidden />
            ) : (
              <ChevronLeft className="size-5" aria-hidden />
            )}
          </Button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden p-2">
          <button
            type="button"
            onClick={handleNewChat}
            title="New chat"
            className={cn(
              "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors duration-200 w-full",
              sidebarCollapsed ? "justify-center px-0" : "px-3",
              pathname === "/"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}
          >
            <MessageSquarePlus className="size-5 shrink-0" aria-hidden />
            {!sidebarCollapsed && <span>New chat</span>}
          </button>
          {user && conversationsError && !sidebarCollapsed && (
            <Alert variant="destructive" className="mt-2 py-2 px-3 text-xs">
              <AlertTitle className="text-xs leading-tight">Chat sync</AlertTitle>
              <AlertDescription className="text-[11px] leading-snug break-words">
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
              className="mx-auto flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"
              aria-label="Chat sync error; dismiss"
            >
              <AlertCircle className="size-5" aria-hidden />
            </button>
          )}

          {user && !sidebarCollapsed && (
            <div className="mt-3 space-y-1 border-t border-sidebar-border pt-3">
              {conversations.length === 0 ? (
                <>
                  <p className="px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Chats
                  </p>
                  <p className="px-2.5 py-2 text-[11px] text-muted-foreground/80">No chats yet</p>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={toggleChatsSection}
                    aria-expanded={chatsExpanded}
                    aria-controls="sidebar-chats-list"
                    className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-sidebar-accent/30 hover:text-sidebar-foreground"
                  >
                    <span className="truncate">Chats</span>
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
                      id="sidebar-chats-list"
                      className="max-h-48 space-y-0.5 overflow-y-auto pr-1 min-h-[2rem]"
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
                              "flex w-full cursor-pointer items-center rounded-md px-2.5 py-2 text-left text-xs transition-colors",
                              selected
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "text-muted-foreground hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
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
            <div className="mt-2 flex flex-col items-center border-t border-sidebar-border pt-2">
              <Link
                href="/chats"
                title="All chats"
                className={cn(
                  "flex size-10 cursor-pointer items-center justify-center rounded-lg transition-colors",
                  pathname === "/chats"
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <MessageSquare className="size-5 shrink-0" aria-hidden />
              </Link>
            </div>
          )}
          <Link
            href="/sources"
            title="Data Sources"
            className={cn(
              "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors duration-200 mt-2",
              sidebarCollapsed ? "justify-center px-0" : "px-3",
              pathname === "/sources"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}
          >
            <Database className="size-5 shrink-0" aria-hidden />
            {!sidebarCollapsed && <span>Data Sources</span>}
          </Link>
        </nav>
        <div
          className={cn(
            "border-t border-sidebar-border shrink-0 space-y-2",
            sidebarCollapsed ? "p-2 flex flex-col items-center" : "p-4"
          )}
        >
          {!loading && (
            <>
              {user ? (
                <div className={cn("space-y-2", sidebarCollapsed && "flex flex-col items-center")}>
                  {!sidebarCollapsed && (
                    <p className="truncate text-xs text-muted-foreground" title={user.email}>
                      {user.name || user.email}
                    </p>
                  )}
                  <Button
                    variant="ghost"
                    size={sidebarCollapsed ? "icon" : "sm"}
                    className={cn(
                      "cursor-pointer",
                      sidebarCollapsed ? "size-9" : "w-full justify-start"
                    )}
                    title="Sign out"
                    onClick={() => signOut()}
                  >
                    <LogOut className={cn("size-4", !sidebarCollapsed && "mr-2")} />
                    {!sidebarCollapsed && "Sign out"}
                  </Button>
                </div>
              ) : (
                <div className={cn("flex flex-col gap-2", sidebarCollapsed && "items-center")}>
                  <Link
                    href="/login"
                    title="Sign in"
                    className={cn(
                      "inline-flex cursor-pointer items-center justify-center rounded-lg border border-border bg-background text-sm font-medium transition-colors hover:bg-muted hover:text-foreground",
                      sidebarCollapsed ? "size-10" : "h-7 w-full gap-1.5 px-2.5"
                    )}
                  >
                    <LogIn className="size-3.5" />
                    {!sidebarCollapsed && "Sign in"}
                  </Link>
                  <Link
                    href="/signup"
                    title="Sign up"
                    className={cn(
                      "inline-flex cursor-pointer items-center justify-center rounded-lg text-sm font-medium transition-colors hover:bg-muted hover:text-foreground",
                      sidebarCollapsed ? "size-10" : "h-7 w-full gap-1.5 px-2.5"
                    )}
                  >
                    <UserPlus className="size-3.5" />
                    {!sidebarCollapsed && "Sign up"}
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
      <main className="flex-1 pl-[var(--sidebar-width)] transition-[padding-left] duration-200 ease-out">
        {children}
      </main>
    </div>
  );
}
