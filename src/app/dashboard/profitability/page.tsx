"use client";

import { useState, useEffect } from "react";
import { DollarSign, TrendingUp, BarChart3, Layers } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";

interface NicheProfit {
  nicheId: string;
  nicheName: string;
  nicheStatus: string;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  totalOrders: number;
  totalListings: number;
  avgConversion: number;
  totalViews: number;
  profitPerListing: number;
  profitPerOrder: number;
  revenuePerView: number;
}

interface ProductTypeProfit {
  productType: string;
  totalRevenue: number;
  totalProfit: number;
  totalOrders: number;
  avgMargin: number;
}

interface DesignStyleProfit {
  designType: string;
  totalRevenue: number;
  totalProfit: number;
  totalOrders: number;
}

export default function ProfitabilityPage() {
  const [data, setData] = useState<{
    nicheProfit: NicheProfit[];
    productTypeProfit: ProductTypeProfit[];
    designStyleProfit: DesignStyleProfit[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/profitability");
      if (!res.ok) throw new Error(`Couldn't load profitability data (${res.status})`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load profitability data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <div className="page-header">
          <h1 className="text-2xl font-bold text-fg tracking-tight">Profitability</h1>
        </div>
        <ErrorState message={error} onRetry={loadData} retrying={loading} />
      </div>
    );
  }

  if (!data) return null;

  const totalRevenue = data.nicheProfit.reduce((s, n) => s + n.totalRevenue, 0);
  const totalProfit = data.nicheProfit.reduce((s, n) => s + n.totalProfit, 0);
  const totalOrders = data.nicheProfit.reduce((s, n) => s + n.totalOrders, 0);
  const overallMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  const profitableNiches = data.nicheProfit.filter((n) => n.totalProfit > 0);
  const unprofitableNiches = data.nicheProfit.filter((n) => n.totalOrders > 0 && n.totalProfit <= 0);

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="page-header">
        <h1 className="text-2xl font-bold text-fg tracking-tight">Profitability</h1>
        <p className="text-sm text-fg-subtle mt-1">Revenue, profit, and ROAS across niches, products, and styles.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="Total Revenue"
          value={`$${totalRevenue.toFixed(2)}`}
          tone="success"
          icon={<DollarSign className="h-4 w-4" strokeWidth={2} />}
        />
        <StatCard
          label="Total Profit"
          value={`$${totalProfit.toFixed(2)}`}
          detail={`${overallMargin.toFixed(1)}% margin`}
          tone={totalProfit >= 0 ? "success" : "danger"}
          icon={<TrendingUp className="h-4 w-4" strokeWidth={2} />}
        />
        <StatCard
          label="Profitable Niches"
          value={profitableNiches.length}
          detail={`${unprofitableNiches.length} losing money`}
          tone="brand"
          icon={<BarChart3 className="h-4 w-4" strokeWidth={2} />}
        />
        <StatCard
          label="Total Orders"
          value={totalOrders}
          detail={totalOrders > 0 ? `$${(totalProfit / totalOrders).toFixed(2)}/order` : undefined}
          tone="info"
          icon={<Layers className="h-4 w-4" strokeWidth={2} />}
        />
      </div>

      {/* Niche profitability table */}
      <Card>
        <CardHeader>
          <CardTitle>Profit by Niche</CardTitle>
        </CardHeader>
        <CardContent>
          {data.nicheProfit.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="h-6 w-6" />}
              title="No data yet"
              description="Profitability data appears once listings generate sales."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 border-y border-border">
                  <tr className="text-left">
                    <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Niche</th>
                    <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Status</th>
                    <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">Listings</th>
                    <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">Orders</th>
                    <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">Revenue</th>
                    <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">Profit</th>
                    <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">$/Listing</th>
                    <th className="px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">Conv%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.nicheProfit.map((n) => (
                    <tr key={n.nicheId} className="hover:bg-surface-hover transition-colors">
                      <td className="px-4 py-3 font-medium text-fg max-w-[200px] truncate">{n.nicheName}</td>
                      <td className="px-4 py-3 text-xs capitalize text-fg-muted">{n.nicheStatus}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-muted">{n.totalListings}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-muted">{n.totalOrders}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-fg">${n.totalRevenue.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        <span className={n.totalProfit >= 0 ? "text-success" : "text-danger"}>
                          ${n.totalProfit.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-muted">${n.profitPerListing.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-muted">{n.avgConversion.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Product type profitability */}
        <Card>
          <CardHeader>
            <CardTitle>Profit by Product Type</CardTitle>
          </CardHeader>
          <CardContent>
            {data.productTypeProfit.length === 0 ? (
              <p className="text-sm text-fg-subtle">No product data yet.</p>
            ) : (
              <div className="space-y-3">
                {data.productTypeProfit.map((p) => {
                  const maxRevenue = Math.max(...data.productTypeProfit.map((x) => x.totalRevenue), 1);
                  const barWidth = (p.totalRevenue / maxRevenue) * 100;
                  return (
                    <div key={p.productType} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-fg capitalize">{p.productType.replace(/_/g, " ")}</span>
                        <span className="tabular-nums text-fg-muted">
                          ${p.totalProfit.toFixed(2)} profit / {p.totalOrders} orders
                        </span>
                      </div>
                      <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${p.totalProfit >= 0 ? "bg-brand" : "bg-danger"}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <div className="text-xs text-fg-faint">{p.avgMargin.toFixed(1)}% margin</div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Design style profitability */}
        <Card>
          <CardHeader>
            <CardTitle>Profit by Design Style</CardTitle>
          </CardHeader>
          <CardContent>
            {data.designStyleProfit.length === 0 ? (
              <p className="text-sm text-fg-subtle">No design data yet.</p>
            ) : (
              <div className="space-y-3">
                {data.designStyleProfit.map((d) => {
                  const maxRevenue = Math.max(...data.designStyleProfit.map((x) => x.totalRevenue), 1);
                  const barWidth = (d.totalRevenue / maxRevenue) * 100;
                  return (
                    <div key={d.designType} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-fg capitalize">{d.designType}</span>
                        <span className="tabular-nums text-fg-muted">
                          ${d.totalProfit.toFixed(2)} profit / {d.totalOrders} orders
                        </span>
                      </div>
                      <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${d.totalProfit >= 0 ? "bg-success" : "bg-danger"}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
