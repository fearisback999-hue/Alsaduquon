"use client";

import { useState, useEffect } from "react";
import { StatusBadge } from "@/components/ui/status-badge";

interface Niche {
  id: string;
  name: string;
  compositeScore: number | null;
  status: string;
  source: string | null;
  searchVolume: number | null;
  trendDirection: string | null;
  createdAt: string;
}

export default function NichesPage() {
  const [niches, setNiches] = useState<Niche[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (statusFilter) params.set("status", statusFilter);
    const res = await fetch(`/api/niches?${params}`);
    if (res.ok) {
      const data = await res.json();
      setNiches(data.niches ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [statusFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Niches</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
        >
          <option value="">All statuses</option>
          <option value="discovered">Discovered</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="active">Active</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center text-gray-500 py-8">Loading...</div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Score</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Source</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Volume</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Trend</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {niches.map((niche) => (
                <tr key={niche.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{niche.name}</td>
                  <td className="px-4 py-3">
                    {niche.compositeScore != null ? (
                      <span className={niche.compositeScore >= 7.5 ? "text-green-600 font-medium" : "text-gray-600"}>
                        {niche.compositeScore.toFixed(1)}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={niche.status} /></td>
                  <td className="px-4 py-3 text-gray-500">{niche.source ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{niche.searchVolume?.toLocaleString() ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{niche.trendDirection ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(niche.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {niches.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No niches found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
