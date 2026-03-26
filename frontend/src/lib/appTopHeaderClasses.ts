import { cn } from "@/lib/utils";

/** Top chrome strip: uses CSS vars so the blue reads reliably (not bg-primary/opacity on OKLCH vars). */
export const appTopHeaderStripClass = cn(
  "border-b bg-[var(--app-header-strip-bg)] [border-bottom-color:var(--app-header-strip-border)]"
);
