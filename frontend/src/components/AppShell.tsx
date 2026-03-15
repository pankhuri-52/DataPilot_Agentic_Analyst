"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MessageSquare, Database, LogIn, UserPlus, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/", label: "Chat", icon: MessageSquare },
  { href: "/sources", label: "Data Sources", icon: Database },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading, signOut } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="fixed left-0 top-0 z-30 flex h-full w-56 flex-col border-r border-border bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/80">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
          <span className="font-display text-xl font-semibold tracking-tight text-foreground">
            DataPilot
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-[44px] min-w-[44px] cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-4 space-y-2">
          {!loading && (
            <>
              {user ? (
                <div className="space-y-2">
                  <p className="truncate text-xs text-muted-foreground" title={user.email}>
                    {user.email}
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
