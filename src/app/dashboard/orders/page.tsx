"use client";

import { useState, useEffect } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard } from "@/components/ui/stat-card";

interface Order {
  id: string;
  etsyOrderId: string | null;
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

  async function loadData() {
    setLoading(true);
    const res = await fetch("/api/orders");
    if (res.ok) {
      const data = await res.json();
      setOrders(data.orders ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const totalRevenue = orders.reduce((sum, o) => sum + o.revenue, 0);
  const totalProfit = orders.reduce((sum, o) => sum + (o.profit ?? 0), 0);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Orders</h1>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Orders" value={orders.length} color="blue" />
        <StatCard label="Total Revenue" value={`$${totalRevenue.toFixed(2)}`} color="green" />
        <StatCard label="Total Profit" value={`$${totalProfit.toFixed(2)}`} color="green" />
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Order ID</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Qty</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Revenue</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Cost</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Profit</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {orders.map((order) => (
              <tr key={order.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{order.etsyOrderId ?? order.id.slice(0, 8)}</td>
                <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
                <td className="px-4 py-3">{order.quantity}</td>
                <td className="px-4 py-3">${order.revenue.toFixed(2)}</td>
                <td className="px-4 py-3 text-gray-500">${(order.cost ?? 0).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span className={(order.profit ?? 0) >= 0 ? "text-green-600" : "text-red-600"}>
                    ${(order.profit ?? 0).toFixed(2)}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {order.orderedAt ? new Date(order.orderedAt).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No orders yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
