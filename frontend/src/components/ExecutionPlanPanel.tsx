"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  PauseCircle,
} from "lucide-react";
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
    const title =
      exp === "planner"
        ? String(item.title ?? "").trim() || DEFAULT_LABELS[exp]
        : DEFAULT_LABELS[exp];
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
  return traceDisplayForPhaseEntries(phase, entries);
}

function traceDisplayForPhaseEntries(phase: string, entries: TraceEntry[]): string | undefined {
  const last = entries[entries.length - 1];
  if (!last?.message) return undefined;
  if (phase === "discovery") {
    return formatDiscoveryStatus(last.message, last.output);
  }
  return last.message;
}

function traceEntriesForPhase(trace: TraceEntry[], phase: string): TraceEntry[] {
  return trace.filter((e) => e.agent === phase);
}

/** Phase is finished only on terminal trace row (matches backend append_trace contract). */
function isPhaseTerminalComplete(trace: TraceEntry[], phase: ExecutionPhase): boolean {
  const entries = traceEntriesForPhase(trace, phase);
  if (entries.length === 0) return false;
  const last = entries[entries.length - 1];
  return last.status === "success" || last.status === "error";
}

/**
 * While the graph runs, only one pipeline phase is "current": the first in order
 * that has not yet emitted a terminal success/error. Never advance on a later
 * agent's info lines alone (avoids executor=✓ while validator shows a spinner).
 */
function sequentialPipelineActivePhase(trace: TraceEntry[]): ExecutionPhase {
  for (const phase of EXECUTION_PHASE_ORDER) {
    if (!isPhaseTerminalComplete(trace, phase)) {
      return phase;
    }
  }
  return "visualization";
}

function phaseEntriesForDisplay(
  trace: TraceEntry[],
  phase: ExecutionPhase,
  active: ExecutionPhase,
  loading: boolean
): TraceEntry[] {
  const raw = traceEntriesForPhase(trace, phase);
  if (!loading) return raw;
  const pi = phaseIdx(phase);
  const ai = phaseIdx(active);
  if (pi > ai) return [];
  return raw;
}

function formatTraceEntryMessage(phase: string, entry: TraceEntry): string {
  const raw = (entry.message ?? "").trim();
  if (!raw) return "…";
  if (phase === "discovery") {
    return formatDiscoveryStatus(entry.message, entry.output) ?? raw;
  }
  return raw;
}

type PhaseStepStatus = "pending" | "active" | "awaiting" | "done";

function isSubstepFailureLike(entry: TraceEntry): boolean {
  if (entry.status === "error") return true;
  const m = (entry.message ?? "").trim().toLowerCase();
  if (entry.status === "info" && m.startsWith("dry run skipped:")) return true;
  return false;
}

function rowStateForTimeline(
  entry: TraceEntry,
  index: number,
  total: number,
  phaseStatus: PhaseStepStatus,
  phase: ExecutionPhase
): "done" | "active" | "error" {
  if (isSubstepFailureLike(entry)) return "error";
  if (phaseStatus === "done") return "done";
  if (phaseStatus === "awaiting" && phase === "optimizer") return "done";
  if (phaseStatus === "active") {
    if (total === 0) return "active";
    if (index < total - 1) return "done";
    if (entry.status === "success") return "done";
    return "active";
  }
  return "done";
}

function useStaggeredSubstepReveal(
  entriesLength: number,
  phaseStatus: PhaseStepStatus
): number {
  const prevLenRef = useRef(0);
  const visibleCountRef = useRef(0);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    visibleCountRef.current = visibleCount;
  }, [visibleCount]);

  useEffect(() => {
    const len = entriesLength;
    if (len === 0) {
      prevLenRef.current = 0;
      visibleCountRef.current = 0;
      setVisibleCount(0);
      return;
    }

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const shouldAnimate =
      phaseStatus === "active" || phaseStatus === "done";

    if (reduceMotion || !shouldAnimate) {
      prevLenRef.current = len;
      visibleCountRef.current = len;
      setVisibleCount(len);
      return;
    }

    const currentVisible = visibleCountRef.current;
    if (len <= currentVisible) {
      prevLenRef.current = len;
      if (len < currentVisible) {
        visibleCountRef.current = len;
        setVisibleCount(len);
      }
      return;
    }

    const start = Math.max(currentVisible, Math.min(prevLenRef.current, len));
    prevLenRef.current = len;

    let step = start;
    if (start === 0) {
      step = 1;
      visibleCountRef.current = step;
      setVisibleCount(step);
    }
    if (step >= len) {
      return;
    }

    const stepMs = phaseStatus === "done" ? 180 : 240;
    const id = window.setInterval(() => {
      step += 1;
      visibleCountRef.current = step;
      setVisibleCount(step);
      if (step >= len) window.clearInterval(id);
    }, stepMs);

    return () => window.clearInterval(id);
  }, [entriesLength, phaseStatus]);

  return visibleCount;
}

function rowStateWithStagger(
  entry: TraceEntry,
  index: number,
  visibleCount: number,
  totalEntries: number,
  phaseStatus: PhaseStepStatus,
  phase: ExecutionPhase
): "done" | "active" | "error" {
  if (isSubstepFailureLike(entry)) return "error";
  if (index < visibleCount - 1) return "done";
  if (index === visibleCount - 1) {
    if (visibleCount < totalEntries) return "active";
    return rowStateForTimeline(entry, index, totalEntries, phaseStatus, phase);
  }
  return "done";
}

// ─────────────────────────────────────────────────────────────────────────────
// SubstepDot — status circle for each substep row
// ─────────────────────────────────────────────────────────────────────────────
function SubstepDot({ state }: { state: "done" | "active" | "error" }) {
  return (
    <div
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border-2 bg-card",
        // Active: primary border + soft glow ring
        state === "active" &&
          "border-primary/60 shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]",
        // Done: emerald border
        state === "done" && "border-emerald-500/40 dark:border-emerald-400/35",
        // Error: destructive border
        state === "error" && "border-destructive/50"
      )}
    >
      {state === "error" && (
        <AlertCircle className="size-3 text-destructive" aria-hidden />
      )}
      {state === "done" && (
        <Check className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
      )}
      {state === "active" && (
        <Loader2
          className="size-3 animate-spin text-primary motion-reduce:animate-none"
          aria-hidden
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PhaseSubstepsTimeline — substep rows (status circles + labels)
// ─────────────────────────────────────────────────────────────────────────────
function PhaseSubstepsTimeline({
  phase,
  phaseStatus,
  entries,
  awaitingExecute,
  isLoading,
}: {
  phase: ExecutionPhase;
  phaseStatus: PhaseStepStatus;
  entries: TraceEntry[];
  awaitingExecute: boolean;
  isLoading: boolean;
}) {
  const showAwaitingRow =
    phaseStatus === "awaiting" && phase === "optimizer" && awaitingExecute;
  const showStartPlaceholder =
    phaseStatus === "active" && isLoading && entries.length === 0;

  const visibleCount = useStaggeredSubstepReveal(entries.length, phaseStatus);
  const visibleEntries = entries.length === 0 ? [] : entries.slice(0, visibleCount);

  if (entries.length === 0 && !showStartPlaceholder && !showAwaitingRow) {
    return null;
  }

  return (
    <div
      className="mt-2 pl-1"
      role="list"
      aria-label={`Steps for ${phase}`}
    >
      {/* Loading placeholder shown before first trace entry arrives */}
      {showStartPlaceholder && (
        <div className="flex items-start gap-2.5 pb-3" role="listitem">
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-primary/40 bg-card shadow-[0_0_0_3px_hsl(var(--primary)/0.10)]">
            <Loader2
              className="size-3 animate-spin text-primary motion-reduce:animate-none"
              aria-hidden
            />
          </div>
          <p className="pt-0.5 text-[11px] leading-snug text-muted-foreground">
            Starting…
          </p>
        </div>
      )}

      {visibleEntries.map((entry, index) => {
        const msg = formatTraceEntryMessage(phase, entry);
        const rs = rowStateWithStagger(
          entry,
          index,
          visibleCount,
          entries.length,
          phaseStatus,
          phase
        );

        return (
          <div
            key={`${phase}-sub-${index}`}
            className="flex items-start gap-2.5 pb-3 last:pb-0"
            role="listitem"
          >
            <SubstepDot state={rs} />
            <p
              className={cn(
                "min-w-0 flex-1 break-words pt-0.5 text-[11px] leading-snug",
                rs === "active"  && "font-medium text-foreground/90",
                rs === "done"    && "text-muted-foreground",
                rs === "error"   && "text-destructive"
              )}
            >
              {msg}
            </p>
          </div>
        );
      })}

      {/* Pause row shown when optimizer is waiting for user confirmation */}
      {showAwaitingRow && (
        <div className="flex items-start gap-2.5" role="listitem">
          <div className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-card shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]">
            <PauseCircle className="size-3 text-primary" aria-hidden />
          </div>
          <p className="pt-0.5 text-[11px] font-medium leading-snug text-primary">
            Awaiting your confirmation to run the query
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PhaseStatusIcon — the larger icon shown next to each top-level phase row
// ─────────────────────────────────────────────────────────────────────────────
function PhaseStatusIcon({ status }: { status: PhaseStepStatus }) {
  if (status === "active") {
    return (
      <Loader2
        className="size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none"
        aria-hidden
      />
    );
  }
  if (status === "awaiting") {
    return (
      <PauseCircle
        className="size-5 shrink-0 text-primary"
        aria-label="Awaiting your confirmation"
      />
    );
  }
  if (status === "done") {
    return (
      <Check
        className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-hidden
      />
    );
  }
  // pending
  return (
    <Circle
      className="size-5 shrink-0 text-muted-foreground/35"
      strokeWidth={1.75}
      aria-hidden
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionPlanPanel — main export
// ─────────────────────────────────────────────────────────────────────────────
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

  const awaitingQueryCache =
    pendingInterrupt?.reason === "query_cache_hit" ||
    pendingInterrupt?.data?.reason === "query_cache_hit";

  /** Single "current" pipeline step while loading — first phase without terminal success/error. */
  const pipelineActivePhase: ExecutionPhase = useMemo(() => {
    if (awaitingExecute) return "optimizer";
    if (awaitingQueryCache) return "planner";
    if (isLoading) {
      if (liveTrace.length === 0) return "planner";
      return sequentialPipelineActivePhase(liveTrace);
    }
    if (lastTraceAgent) return lastTraceAgent;
    return "planner";
  }, [awaitingExecute, awaitingQueryCache, isLoading, liveTrace, lastTraceAgent]);

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
    setAccordionValue((prev) => {
      const prior = Array.isArray(prev) ? prev : [];
      return Array.from(new Set([...prior, pipelineActivePhase]));
    });
  }, [pipelineActivePhase, isLoading, isTurnComplete]);

  function stepStatus(phase: ExecutionPhase): PhaseStepStatus {
    const pi = phaseIdx(phase);
    if (awaitingQueryCache) {
      if (phase === "planner") return "awaiting";
      return "pending";
    }
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
      const ai = phaseIdx(pipelineActivePhase);
      if (pi < ai) return "done";
      if (pi > ai) return "pending";
      if (isPhaseTerminalComplete(liveTrace, phase)) return "done";
      return "active";
    }
    if (lastTraceAgent) {
      const li = phaseIdx(lastTraceAgent);
      if (pi <= li) return "done";
      return "pending";
    }
    return "pending";
  }

  const activeIndex = phaseIdx(pipelineActivePhase);
  const progressLabel = isLoading ? `Step ${activeIndex + 1} of ${steps.length}` : null;

  const runNeedsAttention = Boolean(isLoading || pendingInterrupt);

  return (
    <div
      className={cn(
        "rounded-xl border transition-[box-shadow,background-color,border-color] duration-200",
        runNeedsAttention
          ? "relative z-[2] border-primary/50 bg-primary/[0.07] shadow-md ring-2 ring-primary/25 dark:border-primary/45 dark:bg-primary/12 dark:ring-primary/30"
          : "border-border bg-card/50"
      )}
      aria-busy={runNeedsAttention ? true : undefined}
      aria-live={runNeedsAttention ? "polite" : undefined}
    >
      {/* ── Collapsed "all done" pill ── */}
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
          {/* ── Collapse button (shown after full pipeline completes) ── */}
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
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <p
                className={cn(
                  "text-xs font-semibold uppercase tracking-wider",
                  runNeedsAttention ? "text-primary" : "text-muted-foreground"
                )}
              >
                Execution plan
              </p>
              {runNeedsAttention && (
                <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary dark:bg-primary/25">
                  In progress
                </span>
              )}
            </div>

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
                const phaseEntries = phaseEntriesForDisplay(
                  liveTrace,
                  ph,
                  pipelineActivePhase,
                  isLoading
                );
                const statusLine = traceDisplayForPhaseEntries(ph, phaseEntries);

                const hasTimeline =
                  phaseEntries.length > 0 ||
                  (status === "active" && isLoading && ph === pipelineActivePhase) ||
                  (status === "awaiting" &&
                    ((ph === "optimizer" && awaitingExecute) ||
                      (ph === "planner" && awaitingQueryCache)));

                const detailRaw = step.detail?.trim();
                const compareLine = hasTimeline
                  ? phaseEntries.length > 0
                    ? formatTraceEntryMessage(ph, phaseEntries[phaseEntries.length - 1])
                    : undefined
                  : statusLine;
                const detail =
                  detailRaw && compareLine && textsRedundant(detailRaw, compareLine)
                    ? undefined
                    : detailRaw;

                const showBody = Boolean(
                  detail || hasTimeline || (statusLine && !hasTimeline)
                );

                return (
                  <AccordionItem
                    key={ph}
                    value={ph}
                    className={cn(
                      "border-border/80 rounded-lg",
                      status === "active" &&
                        "relative bg-primary/10 py-1 pl-1 dark:bg-primary/15",
                      status === "active" &&
                        "before:absolute before:left-[-16px] before:top-1 before:bottom-1 before:w-[2px] before:rounded-full before:bg-primary"
                    )}
                  >
                    <div className="flex gap-3 py-2">
                      {/* Phase-level status icon */}
                      <div className="flex shrink-0 flex-col items-center pt-0.5">
                        <PhaseStatusIcon status={status} />
                      </div>

                      <div className="min-w-0 flex-1">
                        {showBody ? (
                          <>
                            <AccordionTrigger className="py-0 pr-1 hover:no-underline">
                              <div className="flex flex-col items-start gap-0.5 text-left">
                                <span
                                  className={cn(
                                    "text-sm font-medium line-clamp-2",
                                    status === "pending" && "text-muted-foreground/60"
                                  )}
                                >
                                  {step.title}
                                </span>

                                {/* Awaiting confirmation sub-label */}
                                {status === "awaiting" &&
                                  ph === "optimizer" &&
                                  !hasTimeline && (
                                    <span className="text-[11px] font-normal text-primary">
                                      Awaiting your confirmation to run the query
                                    </span>
                                  )}

                                {/* Status line shown only when there's no full timeline */}
                                {statusLine &&
                                  status !== "pending" &&
                                  !hasTimeline && (
                                    <span className="text-[11px] font-normal text-muted-foreground line-clamp-3">
                                      {statusLine}
                                    </span>
                                  )}
                              </div>
                            </AccordionTrigger>

                            <AccordionContent className="pb-1 pl-0">
                              <PhaseSubstepsTimeline
                                phase={ph}
                                phaseStatus={status}
                                entries={phaseEntries}
                                awaitingExecute={awaitingExecute}
                                isLoading={isLoading}
                              />

                              {/* Optional plan detail text below substeps */}
                              {detail && (
                                <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                                  {detail}
                                </p>
                              )}
                            </AccordionContent>
                          </>
                        ) : (
                          /* Non-expandable phase (no body content yet) */
                          <div className="py-1">
                            <span
                              className={cn(
                                "text-sm font-medium line-clamp-2",
                                status === "pending" && "text-muted-foreground/60"
                              )}
                            >
                              {step.title}
                            </span>
                            {status === "awaiting" &&
                              ph === "optimizer" &&
                              !hasTimeline && (
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

            {/* Progress label shown during active loading */}
            {progressLabel && (
              <p className="mt-3 text-xs font-medium text-primary motion-reduce:opacity-100">
                {progressLabel} in progress…
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}