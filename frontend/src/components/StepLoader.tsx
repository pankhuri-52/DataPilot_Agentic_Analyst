"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronDown, ChevronRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const AGENT_ORDER = ["planner", "discovery", "executor", "validator", "visualization"];
const AGENT_LABELS: Record<string, string> = {
  planner: "Planning",
  discovery: "Data discovery",
  executor: "Executing query",
  validator: "Validating",
  visualization: "Visualizing",
};

export interface TraceEntry {
  agent: string;
  status: string;
  message?: string;
  output?: Record<string, unknown>;
}

interface StepLoaderProps {
  liveTrace: TraceEntry[];
  isLoading: boolean;
}

function getUniqueAgentsInOrder(trace: TraceEntry[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of trace) {
    if (!seen.has(entry.agent)) {
      seen.add(entry.agent);
      result.push(entry.agent);
    }
  }
  return result;
}

function getTraceForAgent(trace: TraceEntry[], agent: string): TraceEntry[] {
  return trace.filter((e) => e.agent === agent);
}

export function StepLoader({ liveTrace, isLoading }: StepLoaderProps) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const agentsSeen = getUniqueAgentsInOrder(liveTrace);
  const currentAgent = agentsSeen[agentsSeen.length - 1];
  const completedAgents = agentsSeen.slice(0, -1);

  const stepsToShow = isLoading
    ? [...completedAgents, currentAgent ?? AGENT_ORDER[0]].filter(Boolean)
    : agentsSeen.length > 0
      ? agentsSeen
      : AGENT_ORDER.slice(0, 1);

  return (
    <div className="space-y-2">
      {stepsToShow.map((agent, index) => {
        const traceEntries = getTraceForAgent(liveTrace, agent);
        const isCompleted = completedAgents.includes(agent);
        const isActive = agent === currentAgent && isLoading;
        const isPending = !isCompleted && !isActive;
        const label = AGENT_LABELS[agent] ?? agent;
        const isExpanded = expandedStep === agent;

        return (
          <div
            key={`${agent}-${index}`}
            className={cn(
              "rounded-lg border transition-all duration-200",
              isActive && "border-primary/30 bg-accent/30",
              isCompleted && "border-border bg-muted/30",
              isPending && "border-border bg-muted/10 opacity-60"
            )}
          >
            <button
              type="button"
              onClick={() =>
                setExpandedStep(isExpanded ? null : agent)
              }
              className="flex w-full min-h-[44px] cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20"
              aria-expanded={isExpanded}
            >
              {isExpanded ? (
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              {isActive && (
                <Loader2
                  className="size-4 shrink-0 animate-spin text-primary"
                  aria-hidden
                />
              )}
              {isCompleted && (
                <Check
                  className="size-4 shrink-0 text-primary"
                  aria-hidden
                />
              )}
              {isPending && (
                <div className="size-4 shrink-0 rounded-full border-2 border-muted-foreground/30" />
              )}
              <span className="flex-1 text-sm font-medium">{label}</span>
              {isCompleted && (
                <Badge variant="secondary" className="text-xs">
                  Done
                </Badge>
              )}
              {isActive && (
                <Badge variant="default" className="text-xs">
                  Running
                </Badge>
              )}
            </button>
            {isExpanded && traceEntries.length > 0 && (
              <div className="border-t border-border px-4 py-3 space-y-2">
                {traceEntries.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-md bg-background/50 p-2 text-xs"
                  >
                    <Badge
                      variant={
                        entry.status === "success"
                          ? "default"
                          : entry.status === "error"
                            ? "destructive"
                            : "secondary"
                      }
                      className="shrink-0"
                    >
                      {entry.status}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      {entry.message && (
                        <p className="text-muted-foreground truncate">
                          {entry.message}
                        </p>
                      )}
                      {entry.output && (
                        <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                          {JSON.stringify(entry.output, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {isLoading && liveTrace.length === 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-4">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          <span className="text-sm text-muted-foreground">
            Starting pipeline...
          </span>
        </div>
      )}
    </div>
  );
}
