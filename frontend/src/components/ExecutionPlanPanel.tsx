"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Circle, Loader2, PauseCircle } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

export const EXECUTION_PHASE_ORDER = [
  "planner",
  "discovery",
  "optimizer",
  "executor",
  "validator",
  "visualization",
] as const;

export type ExecutionPhase = (typeof EXECUTION_PHASE_ORDER)[number];

export interface ExecutionStepRow {
  phase: string;
  title: string;
  detail?: string | null;
}

export interface TraceEntry {
  agent: string;
  status: string;
  message?: string;
  output?: Record<string, unknown>;
}

const DEFAULT_LABELS: Record<ExecutionPhase, string> = {
  planner: "Plan the analysis",
  discovery: "Check data availability",
  optimizer: "Build SQL and review cost",
  executor: "Execute the query",
  validator: "Validate results",
  visualization: "Visualize and explain",
};

function isPhase(a: string): a is ExecutionPhase {
  return (EXECUTION_PHASE_ORDER as readonly string[]).includes(a);
}

function phaseIdx(p: ExecutionPhase): number {
  return EXECUTION_PHASE_ORDER.indexOf(p);
}

function defaultExecutionSteps(): ExecutionStepRow[] {
  return EXECUTION_PHASE_ORDER.map((phase) => ({
    phase,
    title: DEFAULT_LABELS[phase],
    detail: null,
  }));
}

function normalizeExecutionSteps(plan?: Record<string, unknown>): ExecutionStepRow[] {
  const raw = plan?.execution_steps;
  if (!Array.isArray(raw) || raw.length !== 6) {
    return defaultExecutionSteps();
  }
  const rows: ExecutionStepRow[] = [];
  for (let i = 0; i < 6; i++) {
    const exp = EXECUTION_PHASE_ORDER[i];
    const item = raw[i] as Record<string, unknown> | undefined;
    if (!item || typeof item !== "object") {
      return defaultExecutionSteps();
    }
    const phase = String(item.phase ?? "");
    if (phase !== exp) {
      return defaultExecutionSteps();
    }
    const title = String(item.title ?? "").trim() || DEFAULT_LABELS[exp];
    const d = item.detail;
    const detail =
      typeof d === "string" && d.trim() ? d.trim() : d != null ? String(d) : null;
    rows.push({ phase, title, detail });
  }
  return rows;
}

function textsRedundant(a: string | undefined, b: string | undefined): boolean {
  const na = (a ?? "").trim().toLowerCase();
  const nb = (b ?? "").trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 14 && nb.length >= 14 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

const FEASIBILITY_LABELS: Record<string, string> = {
  full: "All requested metrics and dimensions are available in your connected data.",
  partial:
    "We can answer a close version of your question; some parts were adjusted to match your data.",
  none: "Your connected data does not support this analysis as requested.",
};

/** Human-friendly line for discovery; supports legacy traces like "Feasibility: full". */
function formatDiscoveryStatus(
  rawMessage: string | undefined,
  output?: Record<string, unknown>
): string | undefined {
  const fromOutput = output?.feasibility;
  if (typeof fromOutput === "string") {
    const key = fromOutput.trim().toLowerCase();
    if (key in FEASIBILITY_LABELS) return FEASIBILITY_LABELS[key];
  }
  const m = (rawMessage ?? "").trim();
  if (!m) return undefined;
  const lower = m.toLowerCase();
  if (lower.startsWith("feasibility:")) {
    const rest = lower.replace(/^feasibility:\s*/i, "").trim();
    if (rest in FEASIBILITY_LABELS) return FEASIBILITY_LABELS[rest];
  }
  return m;
}

function traceDisplayForPhase(trace: TraceEntry[], phase: string): string | undefined {
  const entries = trace.filter((e) => e.agent === phase);
  const last = entries[entries.length - 1];
  if (!last?.message) return undefined;
  if (phase === "discovery") {
    return formatDiscoveryStatus(last.message, last.output);
  }
  return last.message;
}

export interface ExecutionPlanPanelProps {
  plan?: Record<string, unknown>;
  liveTrace: TraceEntry[];
  isLoading: boolean;
  isTurnComplete: boolean;
  pendingInterrupt?: { reason: string; data?: Record<string, unknown> };
}

export function ExecutionPlanPanel({
  plan,
  liveTrace,
  isLoading,
  isTurnComplete,
  pendingInterrupt,
}: ExecutionPlanPanelProps) {
  const steps = useMemo(() => normalizeExecutionSteps(plan), [plan]);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [accordionValue, setAccordionValue] = useState<string[]>([]);

  const lastTraceAgent: ExecutionPhase | null = useMemo(() => {
    if (liveTrace.length === 0) return null;
    const a = liveTrace[liveTrace.length - 1].agent;
    return isPhase(a) ? a : null;
  }, [liveTrace]);

  const awaitingExecute =
    pendingInterrupt?.reason === "execute_query" ||
    pendingInterrupt?.data?.reason === "execute_query";

  const activePhase: ExecutionPhase = useMemo(() => {
    if (awaitingExecute) return "optimizer";
    if (isLoading && liveTrace.length === 0) return "planner";
    if (lastTraceAgent) return lastTraceAgent;
    return "planner";
  }, [awaitingExecute, isLoading, liveTrace.length, lastTraceAgent]);

  const fullPipelineComplete =
    isTurnComplete && lastTraceAgent === "visualization";

  useEffect(() => {
    if (fullPipelineComplete) {
      setPanelCollapsed(true);
      setAccordionValue([]);
    }
  }, [fullPipelineComplete]);

  useEffect(() => {
    if (isTurnComplete || !isLoading) return;
    setAccordionValue([activePhase]);
  }, [activePhase, isLoading, isTurnComplete]);

  function stepStatus(phase: ExecutionPhase): "pending" | "active" | "awaiting" | "done" {
    const pi = phaseIdx(phase);
    if (awaitingExecute) {
      if (phase === "optimizer") return "awaiting";
      if (pi < phaseIdx("optimizer")) return "done";
      return "pending";
    }
    if (isTurnComplete) {
      if (!lastTraceAgent) return "done";
      const li = phaseIdx(lastTraceAgent);
      if (pi <= li) return "done";
      return "pending";
    }
    if (isLoading) {
      const ai = phaseIdx(activePhase);
      if (pi < ai) return "done";
      if (pi === ai) return "active";
      return "pending";
    }
    if (lastTraceAgent) {
      const li = phaseIdx(lastTraceAgent);
      if (pi <= li) return "done";
      return "pending";
    }
    return "pending";
  }

  const activeIndex = phaseIdx(activePhase);
  const progressLabel = isLoading ? `Step ${activeIndex + 1} of ${steps.length}` : null;

  return (
    <div className="rounded-xl border border-border bg-card/50">
      {panelCollapsed && fullPipelineComplete ? (
        <button
          type="button"
          onClick={() => setPanelCollapsed(false)}
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
            <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Analysis complete</p>
            <p className="text-xs text-muted-foreground">
              All {steps.length} steps finished · Expand for details
            </p>
          </div>
        </button>
      ) : (
        <>
          {fullPipelineComplete && !panelCollapsed && (
            <button
              type="button"
              onClick={() => setPanelCollapsed(true)}
              className="mb-1 flex cursor-pointer items-center gap-1 rounded-md px-4 pt-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className="size-3" aria-hidden />
              Collapse summary
            </button>
          )}
          <div className="px-4 pb-4 pt-2">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Execution plan
            </p>
            <Accordion
              multiple
              value={accordionValue}
              onValueChange={(v) =>
                setAccordionValue(Array.isArray(v) ? v : v ? [v] : [])
              }
              className="w-full"
            >
              {steps.map((step) => {
                const ph = step.phase;
                if (!isPhase(ph)) return null;
                const status = stepStatus(ph);
                const statusLine = traceDisplayForPhase(liveTrace, ph);
                const detailRaw = step.detail?.trim();
                const detail =
                  detailRaw && statusLine && textsRedundant(detailRaw, statusLine)
                    ? undefined
                    : detailRaw;
                const showBody = Boolean(detail || statusLine);

                return (
                  <AccordionItem key={ph} value={ph} className="border-border/80">
                    <div className="flex gap-3 py-2">
                      <div className="flex shrink-0 flex-col items-center pt-0.5">
                        {status === "active" && (
                          <Loader2
                            className="size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none"
                            aria-hidden
                          />
                        )}
                        {status === "awaiting" && (
                          <PauseCircle
                            className="size-5 shrink-0 text-primary"
                            aria-label="Awaiting your confirmation"
                          />
                        )}
                        {status === "done" && (
                          <Check
                            className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
                            aria-hidden
                          />
                        )}
                        {status === "pending" && (
                          <Circle
                            className="size-5 shrink-0 text-muted-foreground/35"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        {showBody ? (
                          <>
                            <AccordionTrigger className="py-0 pr-1 hover:no-underline">
                              <div className="flex flex-col items-start gap-0.5 text-left">
                                <span className="text-sm font-medium line-clamp-2">{step.title}</span>
                                {status === "awaiting" && ph === "optimizer" && (
                                  <span className="text-[11px] font-normal text-primary">
                                    Awaiting your confirmation to run the query
                                  </span>
                                )}
                                {statusLine && status !== "pending" && (
                                  <span className="text-[11px] font-normal text-muted-foreground line-clamp-3">
                                    {statusLine}
                                  </span>
                                )}
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="pb-1 pl-0">
                              {detail && (
                                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                                  {detail}
                                </p>
                              )}
                            </AccordionContent>
                          </>
                        ) : (
                          <div className="py-1">
                            <span className="text-sm font-medium line-clamp-2">{step.title}</span>
                            {status === "awaiting" && ph === "optimizer" && (
                              <p className="mt-0.5 text-[11px] text-primary">
                                Awaiting your confirmation to run the query
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </AccordionItem>
                );
              })}
            </Accordion>
            {progressLabel && (
              <p className="mt-2 text-[11px] text-muted-foreground motion-reduce:opacity-100">
                {progressLabel} in progress…
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
