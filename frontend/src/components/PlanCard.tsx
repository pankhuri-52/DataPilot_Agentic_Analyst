"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PlanCardProps {
  plan: {
    metrics?: string[];
    dimensions?: string[];
    filters?: Record<string, unknown>;
    is_valid?: boolean;
    clarifying_questions?: string[];
    query_scope?: string;
  };
}

export function PlanCard({ plan }: PlanCardProps) {
  const scope = (plan.query_scope || "").toLowerCase();
  const isOutOfScope = scope === "out_of_scope";
  const needsDetail = scope === "needs_clarification";

  if (plan.clarifying_questions && plan.clarifying_questions.length > 0) {
    return (
      <Card
        className={
          isOutOfScope
            ? "border-border/80 bg-card shadow-xs"
            : "border-primary/25 bg-card shadow-xs"
        }
      >
        <CardHeader>
          <CardTitle className="text-base">
            {isOutOfScope
              ? "Outside your data"
              : needsDetail
                ? "Need a bit more detail"
                : "Clarifying questions"}
          </CardTitle>
          <CardDescription>
            {isOutOfScope
              ? "This assistant only answers questions about your connected datasets."
              : needsDetail
                ? "Rephrase or add specifics so we can build an analysis plan."
                : "The agent needs more information to proceed."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            {plan.clarifying_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  /* Valid-plan metrics/dimensions/filters are shown inside ExecutionPlanPanel, not here. */
  return null;
}
