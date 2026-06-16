"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Play,
  Pause,
  PlayCircle,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Loader2,
  DollarSign,
  Circle,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

interface PipelineRun {
  id: string;
  status: string;
  currentStep: number;
  currentStepName: string;
  error?: string | null;
  totalCost?: number | null;
  createdAt: string;
}

interface StepLog {
  id: string;
  stepNumber: number;
  stepName: string;
  status: string;
  outputSummary?: string | null;
  error?: string | null;
  durationMs?: number | null;
  cost?: number | null;
  createdAt?: string;
}

interface PipelineStatus {
  run: PipelineRun | null;
  logs: StepLog[];
  recentRuns: PipelineRun[];
}

const TOTAL_STEPS = 10;
const RUNS_PAGE_SIZE = 10;

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={2.25} />;
    case "failed":
      return <XCircle className="h-4 w-4 text-danger" strokeWidth={2.25} />;
    case "running":
      return <Loader2 className="h-4 w-4 text-info animate-spin" strokeWidth={2.25} />;
    case "paused":
      return <AlertTriangle className="h-4 w-4 text-warning" strokeWidth={2.25} />;
    default:
      return <Circle className="h-4 w-4 text-fg-faint" strokeWidth={2} />;
  }
}

/**
 * Collapses each step's started + completed log entries into a single row.
 * Without this, a 10-step run renders as 20 list items (every step appears
 * twice). We pick the latest status (completed/failed beats started/running)
 * and use the completed entry's duration and cost.
 */
function collapseStepLogs(logs: StepLog[]): StepLog[] {
  const byStep = new Map<number, StepLog>();
  // Process in chronological order so terminal statuses (completed/failed)
  // overwrite intermediate ones (started/running)
  const sorted = [...logs].sort((a, b) => a.stepNumber - b.stepNumber || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  for (const log of sorted) {
    const existing = byStep.get(log.stepNumber);
    if (!existing) {
      byStep.set(log.stepNumber, log);
      continue;
    }
    // Merge: prefer terminal status, prefer non-null duration/cost/summary
    const merged: StepLog = {
      ...existing,
      status: isTerminal(log.status) ? log.status : (isTerminal(existing.status) ? existing.status : log.status),
      durationMs: log.durationMs ?? existing.durationMs,
      cost: log.cost ?? existing.cost,
      outputSummary: log.outputSummary ?? existing.outputSummary,
      error: log.error ?? existing.error,
    };
    byStep.set(log.stepNumber, merged);
  }
  return Array.from(byStep.values()).sort((a, b) => a.stepNumber - b.stepNumber);
}

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "skipped";
}

function playNotificationSound(type: "success" | "error") {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.3;

    if (type === "success") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(523, ctx.currentTime);       // C5
      osc.frequency.setValueAtTime(659, ctx.currentTime + 0.15); // E5
      osc.frequency.setValueAtTime(784, ctx.currentTime + 0.3);  // G5
      gain.gain.setValueAtTime(0.3, ctx.currentTime + 0.4);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
    } else {
      osc.type = "square";
      osc.frequency.setValueAtTime(330, ctx.currentTime);        // E4
      osc.frequency.setValueAtTime(277, ctx.currentTime + 0.2);  // C#4
      gain.gain.setValueAtTime(0.25, ctx.currentTime + 0.35);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    }
  } catch { /* AudioContext not available */ }
}

export default function PipelinePage() {
  const [data, setData] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [autopilotEnabled, setAutopilotEnabled] = useState<boolean | null>(null);
  const [togglingAutopilot, setTogglingAutopilot] = useState(false);
  const [runsLimit, setRunsLimit] = useState(RUNS_PAGE_SIZE);
  const toast = useToast();
  const prevRunStatus = useRef<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [statusRes, settingsRes] = await Promise.all([
        fetch(`/api/pipeline/status?runs=${runsLimit}`),
        fetch("/api/settings"),
      ]);
      if (statusRes.ok) setData(await statusRes.json());
      if (settingsRes.ok) {
        const s = await settingsRes.json();
        const autopilot = s.settings?.find((x: { key: string }) => x.key === "autopilot_enabled");
        setAutopilotEnabled(autopilot?.value !== "false");
      }
    } catch {
      toast.error("Failed to load pipeline status");
    } finally {
      setLoading(false);
    }
  }, [toast, runsLimit]);

  async function triggerPipeline() {
    if (triggering) return;
    setTriggering(true);
    try {
      const res = await fetch("/api/pipeline/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.error(result.error ?? "Pipeline trigger failed");
      } else {
        toast.success(`Pipeline ${result.status} (${result.completedSteps ?? 0} steps)`);
      }
    } catch {
      toast.error("Network error triggering pipeline");
    } finally {
      setTriggering(false);
      loadData();
    }
  }

  async function resumePipeline() {
    if (resuming) return;
    setResuming(true);
    try {
      const res = await fetch("/api/pipeline/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const result = await res.json();
      if (!res.ok) {
        toast.error(result.error ?? "Resume failed");
      } else {
        toast.success(`Pipeline resumed from step ${result.completedSteps ?? 0}`);
      }
    } catch {
      toast.error("Network error resuming pipeline");
    } finally {
      setResuming(false);
      loadData();
    }
  }

  async function toggleAutopilot() {
    if (autopilotEnabled === null) return;
    const newValue = !autopilotEnabled;
    setTogglingAutopilot(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "autopilot_enabled", value: String(newValue) }),
      });
      if (res.ok) {
        setAutopilotEnabled(newValue);
        toast.success(newValue ? "Autopilot resumed" : "Autopilot paused");
      } else {
        toast.error("Failed to update autopilot");
      }
    } catch {
      toast.error("Network error updating autopilot");
    } finally {
      setTogglingAutopilot(false);
    }
  }

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 3s while a run is active
  useEffect(() => {
    const status = data?.run?.status;
    if (status !== "running" && status !== "paused") return;
    const interval = setInterval(() => {
      if (!document.hidden) loadData();
    }, 3000);
    return () => clearInterval(interval);
  }, [data?.run?.status, loadData]);

  // Play a sound when the pipeline finishes or errors out
  useEffect(() => {
    const status = data?.run?.status ?? null;
    const prev = prevRunStatus.current;
    prevRunStatus.current = status;
    if (!prev || prev === status) return;
    if (status === "completed") playNotificationSound("success");
    else if (status === "failed") playNotificationSound("error");
    else if (status === "paused") playNotificationSound("success");
  }, [data?.run?.status]);

  const run = data?.run;
  // When status is completed, show 100% — currentStep can lag at 9 if the
  // engine increments-then-completes vs completes-then-increments
  const effectiveStep = run?.status === "completed" ? TOTAL_STEPS : (run?.currentStep ?? 0);
  const progressPct = run ? (effectiveStep / TOTAL_STEPS) * 100 : 0;
  const progressTone = run?.status === "failed" ? "bg-danger" : run?.status === "completed" ? "bg-success" : "bg-brand";

  const collapsedLogs = useMemo(() => collapseStepLogs(data?.logs ?? []), [data?.logs]);
  const recentRuns = data?.recentRuns ?? [];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-36" />
          </div>
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="page-header flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg tracking-tight">Pipeline</h1>
          <p className="text-sm text-fg-subtle mt-1">10-step automation from niche discovery to listing.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={autopilotEnabled ? "secondary" : "primary"}
            onClick={toggleAutopilot}
            disabled={togglingAutopilot || autopilotEnabled === null}
            loading={togglingAutopilot}
            leftIcon={autopilotEnabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          >
            {autopilotEnabled ? "Pause autopilot" : "Resume autopilot"}
          </Button>
          {run?.status === "paused" && (
            <Button
              variant="primary"
              onClick={resumePipeline}
              disabled={resuming}
              loading={resuming}
              leftIcon={resuming ? undefined : <RotateCcw className="h-4 w-4" />}
            >
              {resuming ? "Resuming…" : "Resume run"}
            </Button>
          )}
          <Button
            variant={run?.status === "paused" ? "secondary" : "primary"}
            onClick={triggerPipeline}
            disabled={triggering}
            loading={triggering}
            leftIcon={triggering ? undefined : <PlayCircle className="h-4 w-4" />}
          >
            {triggering ? "Running…" : "New run"}
          </Button>
        </div>
      </div>

      {/* Autopilot paused banner */}
      {autopilotEnabled === false && (
        <div className="flex items-start gap-3 px-4 py-3 bg-warning-subtle text-warning rounded-xl border border-warning/20">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" strokeWidth={2.25} />
          <div className="text-sm">
            <strong className="font-semibold">Autopilot is paused.</strong> Scheduled cron runs will skip. Manual triggers still work.
          </div>
        </div>
      )}

      {/* Current run */}
      {run ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <CardTitle>Current run</CardTitle>
                <StatusBadge status={run.status} />
              </div>
              {run.totalCost != null && (
                <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
                  <DollarSign className="h-3 w-3" />
                  <span className="tabular-nums">${run.totalCost.toFixed(2)} spent</span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-fg">
                Step {effectiveStep}/{TOTAL_STEPS}
                <span className="text-fg-subtle font-normal ml-2">{run.currentStepName}</span>
              </span>
              <span className="text-xs tabular-nums text-fg-subtle">{Math.round(progressPct)}%</span>
            </div>
            <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${progressTone}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {run.error && (
              <div className="mt-3 flex items-start gap-2 px-3 py-2.5 bg-danger-subtle text-danger rounded-lg text-sm">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" strokeWidth={2.25} />
                <span>{run.error}</span>
              </div>
            )}
            {run.status === "paused" && (
              <div className="mt-4 flex items-center gap-3 px-4 py-3 bg-warning-subtle rounded-xl border border-warning/20">
                <Pause className="h-5 w-5 text-warning flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-fg">Pipeline paused at step {run.currentStep}</p>
                  <p className="text-xs text-fg-subtle mt-0.5">Review is needed before continuing. Resume to pick up where it left off.</p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={resumePipeline}
                  disabled={resuming}
                  loading={resuming}
                  leftIcon={resuming ? undefined : <RotateCcw className="h-3.5 w-3.5" />}
                >
                  {resuming ? "Resuming…" : "Resume"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<PlayCircle className="h-6 w-6" />}
            title="No pipeline runs yet"
            description="Trigger a run to start the automation cycle from niche discovery through listing."
          />
        </Card>
      )}

      {/* Step timeline — collapsed to one row per step */}
      {collapsedLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Step timeline</CardTitle>
            <CardDescription>One row per step ({collapsedLogs.length}/{TOTAL_STEPS}).</CardDescription>
          </CardHeader>
          <div className="px-5 pb-5">
            <ol className="relative border-l-2 border-border ml-2 space-y-1">
              {collapsedLogs.map((log) => (
                <li key={log.id} className="pl-6 pb-3 relative">
                  <span className="absolute -left-[11px] top-0.5 h-5 w-5 rounded-full bg-surface border-2 border-border flex items-center justify-center">
                    <StepIcon status={log.status} />
                  </span>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-mono text-fg-faint tabular-nums">
                          {String(log.stepNumber).padStart(2, "0")}
                        </span>
                        <span className="text-sm font-medium text-fg">{log.stepName}</span>
                      </div>
                      {log.outputSummary && (
                        <p className="text-xs text-fg-subtle mt-0.5 line-clamp-2">{log.outputSummary}</p>
                      )}
                      {log.error && (
                        <p className="text-xs text-danger mt-0.5">{log.error}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-fg-subtle tabular-nums flex-shrink-0">
                      {log.durationMs != null && isTerminal(log.status) && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {(log.durationMs / 1000).toFixed(1)}s
                        </span>
                      )}
                      {log.cost != null && log.cost > 0 && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          {log.cost.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Card>
      )}

      {/* Recent runs */}
      {recentRuns.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle>Recent runs</CardTitle>
                <CardDescription>Last {recentRuns.length} cycle{recentRuns.length === 1 ? "" : "s"}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <div className="divide-y divide-border">
            {recentRuns.map((r) => {
              const rEffectiveStep = r.status === "completed" ? TOTAL_STEPS : r.currentStep;
              return (
                <div key={r.id} className="px-5 py-3 flex items-center justify-between hover:bg-surface-hover transition-colors">
                  <div>
                    <div className="text-sm text-fg">
                      {new Date(r.createdAt).toLocaleString()}
                    </div>
                    <div className="text-xs text-fg-subtle mt-0.5">
                      Step {rEffectiveStep}/{TOTAL_STEPS} • {r.currentStepName}
                      {r.totalCost != null && (
                        <span className="ml-2 tabular-nums">· ${r.totalCost.toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              );
            })}
          </div>
          {recentRuns.length >= runsLimit && (
            <div className="px-5 py-3 border-t border-border">
              <button
                onClick={() => setRunsLimit((n) => n + RUNS_PAGE_SIZE)}
                className="text-xs font-medium text-brand hover:text-brand-hover transition-colors"
              >
                Show more
              </button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
