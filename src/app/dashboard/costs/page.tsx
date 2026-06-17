"use client";

import { useState, useEffect } from "react";
import { Wallet, TrendingUp, CalendarDays, Layers, Cpu, Activity } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import { Progress } from "@/components/ui/progress";
import { ErrorState } from "@/components/ui/error-state";

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

interface TodayEntry {
  id: string;
  category: string;
  amount: number;
  description?: string | null;
}

interface Limits { maxDailyCost: number; maxDailyListings: number }

export default function CostsPage() {
  const [data, setData] = useState<{ dailyCosts: DailyCost[]; todayEntries: TodayEntry[]; recentTokenUsage: TokenUsage[]; limits: Limits } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/costs?days=30");
      if (!res.ok) throw new Error(`Couldn't load cost data (${res.status})`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load cost data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  if (error && !data) {
    return (
      <div className="space-y-6">
        <div className="page-header">
          <h1 className="text-2xl font-bold text-fg tracking-tight">Cost Tracking</h1>
        </div>
        <ErrorState message={error} onRetry={loadData} retrying={loading} />
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const today = data.dailyCosts[0];
  const totalSpent = data.dailyCosts.reduce((sum, d) => sum + d.totalCost, 0);
  const ordered = [...data.dailyCosts].reverse();
  const costSpark = ordered.map((d) => d.totalCost);
  const listingsSpark = ordered.map((d) => d.listingsCreated);

  // Live budget cap from settings — this is what the pipeline actually
  // enforces against, so the UI always matches reality
  const liveMaxCost = data.limits.maxDailyCost;
  const liveMaxListings = data.limits.maxDailyListings;

  const maxCost = Math.max(...costSpark, 0.01);
  const budgetPct = today ? (today.totalCost / Math.max(liveMaxCost, 0.01)) * 100 : 0;
  const budgetTone: "brand" | "warning" | "danger" = budgetPct >= 90 ? "danger" : budgetPct >= 70 ? "warning" : "brand";

  const aiTotal = today?.aiCost ?? 0;
  const apiTotal = today?.apiCost ?? 0;
  const feesTotal = today?.listingFees ?? 0;
  const breakdownTotal = aiTotal + apiTotal + feesTotal || 0.01;

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="page-header">
        <h1 className="text-2xl font-bold text-fg tracking-tight">Cost Tracking</h1>
        <p className="text-sm text-fg-subtle mt-1">AI, API, and listing fee spend across the last 30 days.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="Today's Spend"
          value={`$${(today?.totalCost ?? 0).toFixed(2)}`}
          detail={`of $${liveMaxCost.toFixed(2)} budget`}
          tone={budgetTone}
          icon={<Wallet className="h-4 w-4" strokeWidth={2} />}
          sparkline={costSpark}
        />
        <StatCard
          label="Today's Listings"
          value={today?.listingsCreated ?? 0}
          detail={`of ${liveMaxListings} limit`}
          tone="info"
          icon={<Layers className="h-4 w-4" strokeWidth={2} />}
          sparkline={listingsSpark}
        />
        <StatCard
          label="30-Day Total"
          value={`$${totalSpent.toFixed(2)}`}
          tone="neutral"
          icon={<CalendarDays className="h-4 w-4" strokeWidth={2} />}
        />
        <StatCard
          label="Avg Daily"
          value={`$${(totalSpent / Math.max(data.dailyCosts.length, 1)).toFixed(2)}`}
          tone="brand"
          icon={<TrendingUp className="h-4 w-4" strokeWidth={2} />}
        />
      </div>

      {/* Two-column: budget + breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {today && (
          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s Budget</CardTitle>
              <CardDescription>Real-time spend against your daily ceiling.</CardDescription>
            </CardHeader>
            <div className="px-5 pb-5 space-y-3">
              <Progress value={today.totalCost} max={liveMaxCost} tone={budgetTone} size="md" />
              <div className="flex justify-between text-xs text-fg-subtle tabular-nums">
                <span>
                  <span className="text-fg font-medium">${today.totalCost.toFixed(2)}</span> spent
                </span>
                <span>
                  ${Math.max(0, liveMaxCost - today.totalCost).toFixed(2)} remaining
                </span>
              </div>
            </div>
          </Card>
        )}

        {today && (
          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s Breakdown</CardTitle>
              <CardDescription>Where today&apos;s dollars went.</CardDescription>
            </CardHeader>
            <div className="px-5 pb-5 space-y-3">
              {[
                { label: "AI", value: aiTotal, tone: "brand" as const },
                { label: "API", value: apiTotal, tone: "info" as const },
                { label: "Listing fees", value: feesTotal, tone: "warning" as const },
              ].map((row) => (
                <div key={row.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-fg-muted font-medium">{row.label}</span>
                    <span className="tabular-nums text-fg">${row.value.toFixed(2)}</span>
                  </div>
                  <Progress value={row.value} max={breakdownTotal} tone={row.tone} size="xs" />
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* 30-day trend bar chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>30-Day Trend</CardTitle>
              <CardDescription>Daily total cost</CardDescription>
            </div>
            <Sparkline data={costSpark} width={160} height={40} />
          </div>
        </CardHeader>
        <div className="px-5 pb-5">
          <div className="flex items-end gap-0.5 h-24">
            {ordered.map((d) => {
              const pct = (d.totalCost / maxCost) * 100;
              const isToday = d.date === today?.date;
              return (
                <div
                  key={d.date}
                  className="flex-1 flex flex-col justify-end group relative"
                  title={`${d.date}: $${d.totalCost.toFixed(2)}`}
                >
                  <div
                    className={`w-full rounded-t transition-all ${
                      isToday ? "bg-brand" : "bg-brand/40 group-hover:bg-brand/70"
                    }`}
                    style={{ height: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-fg-faint mt-1.5 tabular-nums">
            <span>{ordered[0]?.date}</span>
            <span>{ordered[ordered.length - 1]?.date}</span>
          </div>
        </div>
      </Card>

      {/* Daily history */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Cost History</CardTitle>
          <CardDescription>Per-day breakdown for the last 30 days.</CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 border-y border-border">
              <tr className="text-left">
                <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Date</th>
                <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle tabular-nums">Total</th>
                <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle tabular-nums">AI</th>
                <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle tabular-nums">API</th>
                <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle tabular-nums">Fees</th>
                <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle tabular-nums">Listings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.dailyCosts.map((day) => (
                <tr key={day.date} className="hover:bg-surface-hover transition-colors">
                  <td className="px-5 py-2.5 text-fg">{day.date}</td>
                  <td className="px-5 py-2.5 font-semibold text-fg tabular-nums">${day.totalCost.toFixed(2)}</td>
                  <td className="px-5 py-2.5 text-fg-muted tabular-nums">${day.aiCost.toFixed(2)}</td>
                  <td className="px-5 py-2.5 text-fg-muted tabular-nums">${day.apiCost.toFixed(2)}</td>
                  <td className="px-5 py-2.5 text-fg-muted tabular-nums">${day.listingFees.toFixed(2)}</td>
                  <td className="px-5 py-2.5 text-fg-muted tabular-nums">{day.listingsCreated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Token usage */}
      {data.recentTokenUsage.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-fg-subtle" />
              <div>
                <CardTitle>Recent Token Usage</CardTitle>
                <CardDescription>Last 20 model calls</CardDescription>
              </div>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-y border-border">
                <tr className="text-left">
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Model</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Operation</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle tabular-nums">Tokens</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle tabular-nums">Cost</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle tabular-nums">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.recentTokenUsage.slice(0, 20).map((usage) => (
                  <tr key={usage.id} className="hover:bg-surface-hover transition-colors">
                    <td className="px-5 py-2.5 font-mono text-xs text-fg">{usage.modelName}</td>
                    <td className="px-5 py-2.5 text-fg-muted">
                      <span className="inline-flex items-center gap-1">
                        <Activity className="h-3 w-3 text-fg-faint" />
                        {usage.operation}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-fg-muted tabular-nums">{usage.totalTokens.toLocaleString()}</td>
                    <td className="px-5 py-2.5 text-fg font-medium tabular-nums">${usage.estimatedCost.toFixed(4)}</td>
                    <td className="px-5 py-2.5 text-fg-faint text-xs tabular-nums">{new Date(usage.createdAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
