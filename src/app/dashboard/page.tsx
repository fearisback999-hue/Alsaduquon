import { db } from "@/lib/db";
import { etsyListings, orders, dailyCosts, pipelineRuns } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const today = new Date().toISOString().split("T")[0];

  const [liveListings, totalOrders, todayCost, latestRun, revenueResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(etsyListings).where(eq(etsyListings.status, "published")).get(),
    db.select({ count: sql<number>`count(*)` }).from(orders).get(),
    db.select().from(dailyCosts).where(eq(dailyCosts.date, today)).get(),
    db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.createdAt)).limit(1).get(),
    db.select({ sum: sql<number>`coalesce(sum(revenue), 0)` }).from(orders).get(),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Live Listings" value={liveListings?.count ?? 0} detail="Target: 500" color="blue" />
        <StatCard label="Total Orders" value={totalOrders?.count ?? 0} color="green" />
        <StatCard label="Total Revenue" value={`$${(revenueResult?.sum ?? 0).toFixed(2)}`} color="green" />
        <StatCard
          label="Today's Cost"
          value={`$${(todayCost?.totalCost ?? 0).toFixed(2)}`}
          detail={`$${(todayCost?.maxDailyCost ?? 10).toFixed(2)} budget`}
          color={todayCost && todayCost.totalCost > todayCost.maxDailyCost * 0.8 ? "red" : "gray"}
        />
      </div>

      {latestRun && (
        <div className="bg-white rounded-lg border p-4 mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-gray-500">Latest Pipeline Run</h2>
            <StatusBadge status={latestRun.status} />
          </div>
          <p className="text-sm text-gray-600 mt-1">
            Step {latestRun.currentStep}/10: {latestRun.currentStepName}
            {latestRun.error && <span className="text-red-500 ml-2">{latestRun.error}</span>}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Started: {latestRun.startedAt ? new Date(latestRun.startedAt).toLocaleString() : "N/A"}
            {latestRun.completedAt && ` | Completed: ${new Date(latestRun.completedAt).toLocaleString()}`}
          </p>
        </div>
      )}

      <div className="bg-white rounded-lg border p-4">
        <h2 className="text-sm font-medium text-gray-500 mb-3">Quick Actions</h2>
        <div className="flex gap-3">
          <a href="/dashboard/pipeline" className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">
            View Pipeline
          </a>
          <a href="/dashboard/approvals" className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700">
            Review Approvals
          </a>
          <a href="/dashboard/settings" className="px-4 py-2 bg-gray-600 text-white rounded-md text-sm hover:bg-gray-700">
            Settings
          </a>
        </div>
      </div>
    </div>
  );
}
