"use client";

import { useState, useEffect } from "react";
import { StatCard } from "@/components/ui/stat-card";

interface DailyCost {
  date: string;
  totalCost: number;
  aiCost: number;
  apiCost: number;
  listingFees: number;
  listingsCreated: number;
  maxDailyCost: number;
  maxDailyListings: number;
}

interface TokenUsage {
  id: string;
  modelName: string;
  operation: string;
  totalTokens: number;
  estimatedCost: number;
  createdAt: string;
}

export default function CostsPage() {
  const [data, setData] = useState<{ dailyCosts: DailyCost[]; todayEntries: any[]; recentTokenUsage: TokenUsage[] } | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    const res = await fetch("/api/costs?days=30");
    if (res.ok) setData(await res.json());
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  if (loading || !data) return <div className="text-center text-gray-500 py-8">Loading costs...</div>;

  const today = data.dailyCosts[0];
  const totalSpent = data.dailyCosts.reduce((sum, d) => sum + d.totalCost, 0);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Cost Tracking</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Today's Cost"
          value={`$${(today?.totalCost ?? 0).toFixed(2)}`}
          detail={`of $${(today?.maxDailyCost ?? 10).toFixed(2)} budget`}
          color={today && today.totalCost > today.maxDailyCost * 0.8 ? "red" : "blue"}
        />
        <StatCard
          label="Today's Listings"
          value={today?.listingsCreated ?? 0}
          detail={`of ${today?.maxDailyListings ?? 5} limit`}
          color="blue"
        />
        <StatCard label="30-Day Total" value={`$${totalSpent.toFixed(2)}`} color="gray" />
        <StatCard label="Avg Daily Cost" value={`$${(totalSpent / Math.max(data.dailyCosts.length, 1)).toFixed(2)}`} color="gray" />
      </div>

      {/* Budget bar */}
      {today && (
        <div className="bg-white rounded-lg border p-4 mb-6">
          <h2 className="text-sm font-medium text-gray-500 mb-2">Today's Budget</h2>
          <div className="w-full bg-gray-200 rounded-full h-4">
            <div
              className={`h-4 rounded-full transition-all ${today.totalCost > today.maxDailyCost * 0.8 ? "bg-red-500" : "bg-blue-500"}`}
              style={{ width: `${Math.min((today.totalCost / today.maxDailyCost) * 100, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>${today.totalCost.toFixed(2)} spent</span>
            <span>${(today.maxDailyCost - today.totalCost).toFixed(2)} remaining</span>
          </div>
        </div>
      )}

      {/* Category breakdown */}
      {today && (
        <div className="bg-white rounded-lg border p-4 mb-6">
          <h2 className="text-sm font-medium text-gray-500 mb-3">Today's Breakdown</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-400">AI Costs</p>
              <p className="text-lg font-medium">${today.aiCost.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">API Costs</p>
              <p className="text-lg font-medium">${today.apiCost.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Listing Fees</p>
              <p className="text-lg font-medium">${today.listingFees.toFixed(2)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Daily history */}
      <div className="bg-white rounded-lg border overflow-hidden mb-6">
        <h2 className="font-medium p-4 border-b text-sm text-gray-500">Daily Cost History</h2>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-500">Date</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500">Total</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500">AI</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500">API</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500">Fees</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500">Listings</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.dailyCosts.map((day) => (
              <tr key={day.date} className="hover:bg-gray-50">
                <td className="px-4 py-2">{day.date}</td>
                <td className="px-4 py-2 font-medium">${day.totalCost.toFixed(2)}</td>
                <td className="px-4 py-2 text-gray-500">${day.aiCost.toFixed(2)}</td>
                <td className="px-4 py-2 text-gray-500">${day.apiCost.toFixed(2)}</td>
                <td className="px-4 py-2 text-gray-500">${day.listingFees.toFixed(2)}</td>
                <td className="px-4 py-2 text-gray-500">{day.listingsCreated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Token usage */}
      {data.recentTokenUsage.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <h2 className="font-medium p-4 border-b text-sm text-gray-500">Recent Token Usage</h2>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-500">Model</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500">Operation</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500">Tokens</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500">Cost</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.recentTokenUsage.slice(0, 20).map((usage) => (
                <tr key={usage.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{usage.modelName}</td>
                  <td className="px-4 py-2 text-gray-500">{usage.operation}</td>
                  <td className="px-4 py-2 text-gray-500">{usage.totalTokens.toLocaleString()}</td>
                  <td className="px-4 py-2">${usage.estimatedCost.toFixed(4)}</td>
                  <td className="px-4 py-2 text-gray-400 text-xs">{new Date(usage.createdAt).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
