"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ResponseSummaryProps {
  answerSummary?: string | null;
  followUpSuggestions?: string[] | null;
  onFollowUpClick?: (text: string) => void;
  className?: string;
}

export function ResponseSummary({
  answerSummary,
  followUpSuggestions,
  onFollowUpClick,
  className,
}: ResponseSummaryProps) {
  const summary = (answerSummary ?? "").trim();
  const chips = (followUpSuggestions ?? []).filter((s) => typeof s === "string" && s.trim());

  if (!summary && chips.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-3",
        className
      )}
    >
      {summary && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Summary
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground">{summary}</p>
        </div>
      )}
      {chips.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            You could also ask
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {chips.map((text) => (
              <Button
                key={text}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto min-h-9 max-w-full cursor-pointer whitespace-normal px-3 py-2 text-left text-xs font-normal"
                onClick={() => onFollowUpClick?.(text)}
              >
                {text}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
