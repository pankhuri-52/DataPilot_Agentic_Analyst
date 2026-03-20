"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronDown, ChevronRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const AGENT_ORDER = ["planner", "discovery", "optimizer", "executor", "validator", "visualization"];
const AGENT_LABELS: Record<string, string> = {
  planner: "Planning",
  discovery: "Data discovery",
  optimizer: "Optimizing SQL",
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

function getNextAgent(agentsSeen: string[]): string | null {
  for (const a of AGENT_ORDER) {
    if (!agentsSeen.includes(a)) return a;
  }
  return null;
}

export function StepLoader({ liveTrace, isLoading }: StepLoaderProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const agentsSeen = getUniqueAgentsInOrder(liveTrace);

  // When job completes, collapse by default so user can expand to see stages
  useEffect(() => {
    if (!isLoading && agentsSeen.length > 0) {
      setIsCollapsed(true);
    }
  }, [isLoading, agentsSeen.length]);
  const currentAgent = agentsSeen.length > 0 ? agentsSeen[agentsSeen.length - 1] : null;
  const currentIdx = agentsSeen.length > 0 ? agentsSeen.length - 1 : -1;
  const nextAgent = getNextAgent(agentsSeen);

  // Planner always first; when loading with no trace, show planner only (no "Starting pipeline")
  const stepsToShow = isLoading
    ? ["planner", ...agentsSeen.filter((a) => a !== "planner")]
    : agentsSeen.length > 0
      ? agentsSeen
      : ["planner"];

  const allComplete = !isLoading && agentsSeen.length > 0;
  const showCollapsedSummary = allComplete && isCollapsed;

  return (
    <div className="space-y-2">
      {showCollapsedSummary ? (
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="flex w-full items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/50"
        >
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Check className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="text-xs font-medium text-muted-foreground">
            {agentsSeen.length} agents completed
          </span>
          <span className="ml-auto text-xs text-muted-foreground">Expand to see stages</span>
        </button>
      ) : (
        <>
          {allComplete && (
            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className="size-3" aria-hidden />
              Collapse
            </button>
          )}
          {stepsToShow.map((agent, index) => {
            const traceEntries = getTraceForAgent(liveTrace, agent);
            const idx = agentsSeen.indexOf(agent);
            const isCompleted =
              !isLoading && idx !== -1
                ? true
                : isLoading && idx !== -1 && currentIdx >= 0
                  ? idx < currentIdx
                  : false;
            const isActive =
              isLoading && agent === currentAgent && currentAgent !== null;
            const isPending = !isCompleted && !isActive;
            const label = AGENT_LABELS[agent] ?? agent;
            const latestEntry = traceEntries[traceEntries.length - 1];
            const latestMessage = latestEntry?.message;

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
                <div className="flex w-full min-h-[40px] items-center gap-3 px-4 py-2.5">
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
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-xs font-medium">{label}</span>
                    {(isActive || isCompleted) && latestMessage && (
                      <span className="text-[11px] text-muted-foreground truncate">
                        {latestMessage}
                      </span>
                    )}
                    {isActive && nextAgent && (
                      <span className="text-[11px] text-muted-foreground/80">
                        Next: {AGENT_LABELS[nextAgent] ?? nextAgent}
                      </span>
                    )}
                  </div>
                  {isCompleted && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      Done
                    </Badge>
                  )}
                  {isActive && agent !== "planner" && (
                    <Badge variant="default" className="text-[10px] shrink-0">
                      Running
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
