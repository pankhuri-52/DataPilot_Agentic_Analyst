"use client";

import { cn } from "@/lib/utils";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";

type AppPageShellProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
  bodyClassName?: string;
};

export function AppPageShell({
  title,
  description,
  children,
  bodyClassName,
}: AppPageShellProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          data-scrollbar
        >
          <header className="sticky top-0 z-30 flex min-h-16 shrink-0 items-center border-b border-primary/35 bg-primary/30 px-3 py-2 backdrop-blur-md supports-[backdrop-filter]:bg-primary/28 dark:border-primary/40 dark:bg-primary/35 dark:supports-[backdrop-filter]:bg-primary/32 sm:px-6">
            <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center gap-1">
                <h1 className="font-display text-sm font-semibold tracking-tight text-foreground">
                  {title}
                </h1>
                {description ? (
                  <p className="text-[12px] leading-snug text-foreground/85 sm:text-[13px] sm:leading-snug">
                    {description}
                  </p>
                ) : null}
              </div>
              <ThemeToggleButton className="size-9 shrink-0 self-center text-foreground/80 hover:bg-primary-foreground/15 hover:text-foreground dark:text-foreground/85 dark:hover:bg-primary-foreground/10" />
            </div>
          </header>
          <div
            className={cn(
              "mx-auto max-w-4xl px-4 py-3 sm:px-6 sm:py-4",
              bodyClassName
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
