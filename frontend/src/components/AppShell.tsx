"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { MessageSquarePlus, MessageSquare, Database, LogIn, UserPlus, LogOut, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/contexts/ChatContext";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const SIDEBAR_CHATS_MAX = 12;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
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

  return (
    <div className="flex min-h-screen">
      <aside className="fixed left-0 top-0 z-30 flex h-full w-56 flex-col border-r border-border bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
          <span className="font-display text-xl font-semibold tracking-tight text-foreground">
            DataPilot
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-4 overflow-y-auto">
          <button
            type="button"
            onClick={handleNewChat}
            className={cn(
              "flex min-h-[44px] min-w-[44px] cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200 w-full",
              pathname === "/"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}
          >
            <MessageSquarePlus className="size-5 shrink-0" aria-hidden />
            New chat
          </button>
          {user && conversationsError && (
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

          {user && (
            <div className="mt-3 space-y-1 border-t border-sidebar-border pt-3">
              <p className="px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Chats
              </p>
              <div className="max-h-48 space-y-0.5 overflow-y-auto pr-1 min-h-[2rem]">
                {conversations.length === 0 ? (
                  <p className="px-2.5 py-2 text-[11px] text-muted-foreground/80">No chats yet</p>
                ) : (
                  conversations.slice(0, SIDEBAR_CHATS_MAX).map((c) => {
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
                  })
                )}
              </div>
              <Link
                href="/chats"
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-[11px] font-medium transition-colors",
                  pathname === "/chats"
                    ? "text-sidebar-accent-foreground bg-sidebar-accent/50"
                    : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/30"
                )}
              >
                <MessageSquare className="size-3.5 shrink-0" aria-hidden />
                View all
              </Link>
            </div>
          )}
          <Link
            href="/sources"
            className={cn(
              "flex min-h-[44px] min-w-[44px] cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200 mt-2",
              pathname === "/sources"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}
          >
            <Database className="size-5 shrink-0" aria-hidden />
            Data Sources
          </Link>
        </nav>
        <div className="border-t border-sidebar-border p-4 space-y-2 shrink-0">
          {!loading && (
            <>
              {user ? (
                <div className="space-y-2">
                  <p className="truncate text-xs text-muted-foreground" title={user.email}>
                    {user.name || user.email}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start cursor-pointer"
                    onClick={() => signOut()}
                  >
                    <LogOut className="size-4 mr-2" />
                    Sign out
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Link
                    href="/login"
                    className="inline-flex h-7 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <LogIn className="size-3.5" />
                    Sign in
                  </Link>
                  <Link
                    href="/signup"
                    className="inline-flex h-7 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <UserPlus className="size-3.5" />
                    Sign up
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
      <main className="flex-1 pl-56">{children}</main>
    </div>
  );
}
