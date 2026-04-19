"use client";

import { useState, useEffect, useCallback } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";

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

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading pipeline…</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
        <div className="flex gap-2">
          <button
            onClick={toggleAutopilot}
            disabled={togglingAutopilot || autopilotEnabled === null}
            className={`px-4 py-2 text-white rounded-md text-sm disabled:opacity-50 ${
              autopilotEnabled ? "bg-yellow-600 hover:bg-yellow-700" : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {togglingAutopilot ? "Updating…" : autopilotEnabled ? "Pause autopilot" : "Resume autopilot"}
          </button>
          <button
            onClick={triggerPipeline}
            disabled={triggering}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {triggering ? "Running…" : "Trigger pipeline"}
          </button>
        </div>
      </div>

      {autopilotEnabled === false && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-6 text-sm text-yellow-800">
          Autopilot is paused. Scheduled cron runs will skip. Manual triggers still work.
        </div>
      )}

      {data?.run ? (
        <div className="bg-white rounded-lg border p-4 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <h2 className="font-medium">Current run</h2>
            <StatusBadge status={data.run.status} />
          </div>
          <p className="text-sm text-gray-600">Step {data.run.currentStep}/10: {data.run.currentStepName}</p>
          {data.run.error && <p className="text-sm text-red-500 mt-1">{data.run.error}</p>}
          <p className="text-xs text-gray-400 mt-2">Cost: ${(data.run.totalCost ?? 0).toFixed(2)}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border p-6 mb-6 text-center text-gray-500 text-sm">
          No pipeline runs yet. Click &quot;Trigger pipeline&quot; to start one.
        </div>
      )}

      {data?.logs && data.logs.length > 0 && (
        <div className="bg-white rounded-lg border">
          <h2 className="font-medium p-4 border-b">Step logs</h2>
          <div className="divide-y">
            {data.logs.map((log) => (
              <div key={log.id} className="p-4 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">Step {log.stepNumber}: {log.stepName}</span>
                  {log.outputSummary && <p className="text-xs text-gray-500 mt-1">{log.outputSummary}</p>}
                  {log.error && <p className="text-xs text-red-500 mt-1">{log.error}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={log.status} />
                  {log.durationMs != null && <span className="text-xs text-gray-400">{(log.durationMs / 1000).toFixed(1)}s</span>}
                  {log.cost != null && log.cost > 0 && <span className="text-xs text-gray-400">${log.cost.toFixed(3)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data?.recentRuns && data.recentRuns.length > 1 && (
        <div className="bg-white rounded-lg border mt-6">
          <h2 className="font-medium p-4 border-b">Recent runs</h2>
          <div className="divide-y">
            {data.recentRuns.map((run) => (
              <div key={run.id} className="p-4 flex items-center justify-between">
                <div>
                  <span className="text-sm text-gray-600">{new Date(run.createdAt).toLocaleString()}</span>
                  <span className="text-xs text-gray-400 ml-3">Step {run.currentStep}/10</span>
                </div>
                <StatusBadge status={run.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
