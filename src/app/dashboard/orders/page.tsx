"use client";

import { useState, useEffect } from "react";
import { ShoppingBag, DollarSign, TrendingUp, Receipt } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";

interface Order {
  id: string;
  externalOrderId: string | null;
  platform: string;
  status: string;
  quantity: number;
  revenue: number;
  cost: number | null;
  profit: number | null;
  orderedAt: string | null;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/orders");
      if (!res.ok) throw new Error(`Couldn't load orders (${res.status})`);
      const data = await res.json();
      setOrders(data.orders ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load orders");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  const totalRevenue = orders.reduce((sum, o) => sum + o.revenue, 0);
  const totalProfit = orders.reduce((sum, o) => sum + (o.profit ?? 0), 0);
  const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && orders.length === 0) {
    return (
      <div className="space-y-6">
        <div className="page-header">
          <h1 className="text-2xl font-bold text-fg tracking-tight">Orders</h1>
          <p className="text-sm text-fg-subtle mt-1">Every sale across all platforms, synced hourly.</p>
        </div>
        <ErrorState message={error} onRetry={loadData} retrying={loading} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="page-header">
        <h1 className="text-2xl font-bold text-fg tracking-tight">Orders</h1>
        <p className="text-sm text-fg-subtle mt-1">Every sale across all platforms, synced hourly.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          label="Total Orders"
          value={orders.length}
          tone="brand"
          icon={<ShoppingBag className="h-4 w-4" strokeWidth={2} />}
        />
        <StatCard
          label="Total Revenue"
          value={`$${totalRevenue.toFixed(2)}`}
          tone="success"
          icon={<DollarSign className="h-4 w-4" strokeWidth={2} />}
        />
        <StatCard
          label="Total Profit"
          value={`$${totalProfit.toFixed(2)}`}
          detail={`${margin.toFixed(1)}% margin`}
          tone={totalProfit >= 0 ? "success" : "danger"}
          icon={<TrendingUp className="h-4 w-4" strokeWidth={2} />}
        />
        <StatCard
          label="Avg Order Value"
          value={`$${avgOrderValue.toFixed(2)}`}
          tone="info"
          icon={<Receipt className="h-4 w-4" strokeWidth={2} />}
        />
      </div>

      {orders.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShoppingBag className="h-6 w-6" />}
            title="No orders yet"
            description="Once customers purchase your listings, orders will sync here."
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-y border-border">
                <tr className="text-left">
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Order ID</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Platform</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Status</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">Qty</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">Revenue</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">Cost</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">Profit</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Ordered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map((order) => {
                  const profit = order.profit ?? 0;
                  return (
                    <tr key={order.id} className="hover:bg-surface-hover transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-fg">{order.externalOrderId ?? order.id.slice(0, 8)}</td>
                      <td className="px-5 py-3 text-xs text-fg-muted capitalize">{order.platform}</td>
                      <td className="px-5 py-3"><StatusBadge status={order.status} /></td>
                      <td className="px-5 py-3 text-right tabular-nums text-fg-muted">{order.quantity}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium text-fg">${order.revenue.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-fg-muted">${(order.cost ?? 0).toFixed(2)}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-semibold">
                        <span className={profit >= 0 ? "text-success" : "text-danger"}>
                          ${profit.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-fg-faint text-xs">
                        {order.orderedAt ? new Date(order.orderedAt).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
