"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Target, Layers, Filter } from "lucide-react";

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
  const metrics = plan.metrics ?? [];
  const dimensions = plan.dimensions ?? [];
  const filters = plan.filters ?? {};
  const filterEntries = Object.entries(filters).filter(
    ([_, v]) => v !== undefined && v !== null && v !== ""
  );

  const scope = (plan.query_scope || "").toLowerCase();
  const isOutOfScope = scope === "out_of_scope";
  const needsDetail = scope === "needs_clarification";

  if (plan.clarifying_questions && plan.clarifying_questions.length > 0) {
    return (
      <Card
        className={
          isOutOfScope
            ? "border-slate-500/35 bg-slate-500/5"
            : "border-amber-500/30 bg-amber-500/5"
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

  if (metrics.length === 0 && dimensions.length === 0 && filterEntries.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">Analysis plan</CardTitle>
        <CardDescription>
          Structured breakdown of the analysis to run
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {metrics.length > 0 && (
          <div className="flex items-start gap-2">
            <Target className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Metrics
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {metrics.map((m) => (
                  <Badge key={m} variant="secondary" className="font-normal">
                    {m}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}
        {dimensions.length > 0 && (
          <div className="flex items-start gap-2">
            <Layers className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Dimensions
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {dimensions.map((d) => (
                  <Badge key={d} variant="outline" className="font-normal">
                    {d}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}
        {filterEntries.length > 0 && (
          <div className="flex items-start gap-2">
            <Filter className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Filters
              </p>
              <div className="mt-1 flex flex-wrap gap-2 text-sm">
                {filterEntries.map(([k, v]) => (
                  <span key={k} className="text-muted-foreground">
                    <span className="font-medium text-foreground">{k}:</span>{" "}
                    {String(v)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
