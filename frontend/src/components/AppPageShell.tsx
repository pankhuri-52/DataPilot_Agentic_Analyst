"use client";

import { cn } from "@/lib/utils";

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
    <div className="flex min-h-screen flex-col">
      <header className="shrink-0 border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex min-h-16 max-w-4xl flex-col justify-center gap-0.5 px-3 py-2 sm:px-6">
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {description}
            </p>
          ) : null}
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        <div className={cn("mx-auto max-w-4xl px-4 py-4 sm:px-6 sm:py-5", bodyClassName)}>
          {children}
        </div>
      </div>
    </div>
  );
}
