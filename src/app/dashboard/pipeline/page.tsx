"use client";

import { useState, useEffect } from "react";
import { StatusBadge } from "@/components/ui/status-badge";

export default function PipelinePage() {
  const [data, setData] = useState<any>(null);
  const [triggering, setTriggering] = useState(false);

  async function loadData() {
    const res = await fetch("/api/pipeline/status");
    if (res.ok) setData(await res.json());
  }

  async function triggerPipeline() {
    setTriggering(true);
    await fetch("/api/pipeline/trigger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    setTriggering(false);
    loadData();
  }

  useEffect(() => { loadData(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
        <button
          onClick={triggerPipeline}
          disabled={triggering}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {triggering ? "Running..." : "Trigger Pipeline"}
        </button>
      </div>

      {data?.run && (
        <div className="bg-white rounded-lg border p-4 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <h2 className="font-medium">Current Run</h2>
            <StatusBadge status={data.run.status} />
          </div>
          <p className="text-sm text-gray-600">Step {data.run.currentStep}/10: {data.run.currentStepName}</p>
          {data.run.error && <p className="text-sm text-red-500 mt-1">{data.run.error}</p>}
          <p className="text-xs text-gray-400 mt-2">Cost: ${(data.run.totalCost ?? 0).toFixed(2)}</p>
        </div>
      )}

      {data?.logs && data.logs.length > 0 && (
        <div className="bg-white rounded-lg border">
          <h2 className="font-medium p-4 border-b">Step Logs</h2>
          <div className="divide-y">
            {data.logs.map((log: any) => (
              <div key={log.id} className="p-4 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">Step {log.stepNumber}: {log.stepName}</span>
                  {log.outputSummary && <p className="text-xs text-gray-500 mt-1">{log.outputSummary}</p>}
                  {log.error && <p className="text-xs text-red-500 mt-1">{log.error}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={log.status} />
                  {log.durationMs && <span className="text-xs text-gray-400">{(log.durationMs / 1000).toFixed(1)}s</span>}
                  {log.cost != null && log.cost > 0 && <span className="text-xs text-gray-400">${log.cost.toFixed(3)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data?.recentRuns && data.recentRuns.length > 1 && (
        <div className="bg-white rounded-lg border mt-6">
          <h2 className="font-medium p-4 border-b">Recent Runs</h2>
          <div className="divide-y">
            {data.recentRuns.map((run: any) => (
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
