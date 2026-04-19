"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Play,
  Pause,
  PlayCircle,
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
}

interface PipelineStatus {
  run: PipelineRun | null;
  logs: StepLog[];
  recentRuns: PipelineRun[];
}

const TOTAL_STEPS = 10;

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

export default function PipelinePage() {
  const [data, setData] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [autopilotEnabled, setAutopilotEnabled] = useState<boolean | null>(null);
  const [togglingAutopilot, setTogglingAutopilot] = useState(false);
  const toast = useToast();

  const loadData = useCallback(async () => {
    try {
      const [statusRes, settingsRes] = await Promise.all([
        fetch("/api/pipeline/status"),
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
  }, [toast]);

  async function triggerPipeline() {
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

  const run = data?.run;
  const progressPct = run ? (run.currentStep / TOTAL_STEPS) * 100 : 0;
  const progressTone = run?.status === "failed" ? "bg-danger" : run?.status === "running" ? "bg-brand" : "bg-success";

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
      <div className="flex items-center justify-between flex-wrap gap-3">
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
          <Button
            variant="primary"
            onClick={triggerPipeline}
            disabled={triggering}
            loading={triggering}
            leftIcon={<PlayCircle className="h-4 w-4" />}
          >
            Trigger run
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
                Step {run.currentStep}/{TOTAL_STEPS}
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

      {/* Step timeline */}
      {data?.logs && data.logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Step timeline</CardTitle>
            <CardDescription>Live status for each step in the current run.</CardDescription>
          </CardHeader>
          <div className="px-5 pb-5">
            <ol className="relative border-l-2 border-border ml-2 space-y-1">
              {data.logs.map((log) => (
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
                      {log.durationMs != null && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {(log.durationMs / 1000).toFixed(1)}s
                        </span>
                      )}
                      {log.cost != null && log.cost > 0 && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          {log.cost.toFixed(3)}
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
      {data?.recentRuns && data.recentRuns.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
            <CardDescription>Last {data.recentRuns.length} cycles</CardDescription>
          </CardHeader>
          <div className="divide-y divide-border">
            {data.recentRuns.map((r) => (
              <div key={r.id} className="px-5 py-3 flex items-center justify-between hover:bg-surface-hover transition-colors">
                <div>
                  <div className="text-sm text-fg">
                    {new Date(r.createdAt).toLocaleString()}
                  </div>
                  <div className="text-xs text-fg-subtle mt-0.5">Step {r.currentStep}/{TOTAL_STEPS} • {r.currentStepName}</div>
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
