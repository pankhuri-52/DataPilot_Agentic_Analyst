"use client";

import { ThemeToggleButton } from "@/components/ThemeToggleButton";

export function AuthThemeCorner() {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 sm:right-6 sm:top-6">
      <div className="pointer-events-auto rounded-xl border border-border/80 bg-background/90 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <ThemeToggleButton className="size-10 text-muted-foreground hover:bg-accent/60 hover:text-foreground" />
      </div>
    </div>
  );
}
