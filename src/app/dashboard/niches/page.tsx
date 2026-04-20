"use client";

import { useState, useEffect } from "react";
import { Hash, TrendingUp, TrendingDown, Minus, Search, Filter, BarChart3 } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

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

const FILTERS = [
  { value: "", label: "All" },
  { value: "discovered", label: "Discovered" },
  { value: "approved", label: "Approved" },
  { value: "active", label: "Active" },
  { value: "rejected", label: "Rejected" },
];

function TrendIndicator({ direction }: { direction: string | null }) {
  if (!direction) return <span className="text-fg-faint">—</span>;
  if (direction.includes("growing") || direction.includes("up") || direction === "explosive") {
    return (
      <span className="inline-flex items-center gap-1 text-success text-xs">
        <TrendingUp className="h-3 w-3" strokeWidth={2.25} />
        {direction}
      </span>
    );
  }
  if (direction.includes("declining") || direction.includes("down")) {
    return (
      <span className="inline-flex items-center gap-1 text-danger text-xs">
        <TrendingDown className="h-3 w-3" strokeWidth={2.25} />
        {direction}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-fg-muted text-xs">
      <Minus className="h-3 w-3" strokeWidth={2.25} />
      {direction}
    </span>
  );
}

function ScoreBar({ score }: { score: number | null }) {
  if (score == null) return <span className="text-fg-faint">—</span>;
  const pct = Math.min(100, (score / 10) * 100);
  const tone = score >= 7.5 ? "bg-success" : score >= 5 ? "bg-info" : "bg-warning";
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${score >= 7.5 ? "text-success" : "text-fg"}`}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

export default function NichesPage() {
  const [niches, setNiches] = useState<Niche[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
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

  const filtered = search
    ? niches.filter((n) => n.name.toLowerCase().includes(search.toLowerCase()))
    : niches;

  const avgScore =
    niches.filter((n) => n.compositeScore != null).reduce((sum, n) => sum + (n.compositeScore ?? 0), 0) /
    Math.max(niches.filter((n) => n.compositeScore != null).length, 1);

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg tracking-tight">Niches</h1>
          <p className="text-sm text-fg-subtle mt-1">
            {niches.length} discovered
            {niches.length > 0 && (
              <>
                {" · "}avg score <span className="font-semibold text-fg tabular-nums">{avgScore.toFixed(1)}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Filter & search */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-fg-faint" />
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                statusFilter === f.value
                  ? "bg-brand text-brand-fg"
                  : "bg-surface-2 text-fg-muted hover:bg-surface-hover hover:text-fg"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-faint pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search niches…"
            className="h-9 pl-8 pr-3 w-56 bg-surface border border-border rounded-lg text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all"
          />
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Hash className="h-6 w-6" />}
            title="No niches found"
            description={
              search
                ? `Nothing matches "${search}". Try clearing the search.`
                : "Run the pipeline to discover and score new niches."
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-y border-border">
                <tr className="text-left">
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Name</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Score</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Status</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Source</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle tabular-nums">Volume</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Trend</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Discovered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((niche) => (
                  <tr key={niche.id} className="hover:bg-surface-hover transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Hash className="h-3.5 w-3.5 text-fg-faint flex-shrink-0" />
                        <span className="font-medium text-fg">{niche.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3"><ScoreBar score={niche.compositeScore} /></td>
                    <td className="px-5 py-3"><StatusBadge status={niche.status} /></td>
                    <td className="px-5 py-3 text-fg-muted text-xs">{niche.source ?? "—"}</td>
                    <td className="px-5 py-3 text-fg-muted tabular-nums">
                      {niche.searchVolume != null ? (
                        <span className="inline-flex items-center gap-1">
                          <BarChart3 className="h-3 w-3 text-fg-faint" />
                          {niche.searchVolume.toLocaleString()}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-5 py-3"><TrendIndicator direction={niche.trendDirection} /></td>
                    <td className="px-5 py-3 text-fg-faint text-xs">{new Date(niche.createdAt).toLocaleDateString()}</td>
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
