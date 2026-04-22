import Link from "next/link";
import { db } from "@/lib/db";
import { etsyListings, orders, dailyCosts, pipelineRuns, settings } from "@/lib/db/schema";
import { eq, desc, sql, gte } from "drizzle-orm";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import {
  Package,
  ShoppingBag,
  DollarSign,
  Boxes,
  Wallet,
  Workflow,
  CheckSquare,
  Settings as SettingsIcon,
  ArrowRight,
  Clock,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const today = new Date().toISOString().split("T")[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().split("T")[0];

  const [liveListings, totalOrders, todayCost, latestRun, revenueResult, enabledProductsSetting, costHistory] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(etsyListings).where(eq(etsyListings.status, "published")).get(),
    db.select({ count: sql<number>`count(*)` }).from(orders).get(),
    db.select().from(dailyCosts).where(eq(dailyCosts.date, today)).get(),
    db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.createdAt)).limit(1).get(),
    db.select({ sum: sql<number>`coalesce(sum(revenue), 0)` }).from(orders).get(),
    db.select().from(settings).where(eq(settings.key, "enabled_product_types")).get(),
    db
      .select({ date: dailyCosts.date, cost: dailyCosts.totalCost, listings: dailyCosts.listingsCreated })
      .from(dailyCosts)
      .where(gte(dailyCosts.date, sevenDaysAgo))
      .orderBy(dailyCosts.date)
      .all(),
  ]);

  let enabledProductCount = 0;
  if (enabledProductsSetting) {
    try { enabledProductCount = JSON.parse(enabledProductsSetting.value).length; } catch { /* ignore */ }
  }

  const costSpark = costHistory.map((h) => h.cost ?? 0);
  const listingSpark = costHistory.map((h) => h.listings ?? 0);

  const budgetPct = todayCost ? (todayCost.totalCost / Math.max(todayCost.maxDailyCost, 0.01)) * 100 : 0;
  const costTone: "warning" | "danger" | "brand" = budgetPct >= 90 ? "danger" : budgetPct >= 70 ? "warning" : "brand";

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Page header */}
      <div className="page-header flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-fg tracking-tight">Overview</h1>
          <p className="text-sm text-fg-subtle mt-1">
            Your automated POD pipeline at a glance.
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/dashboard/pipeline" variant="primary" rightIcon={<ArrowRight className="h-4 w-4" />}>
            View pipeline
          </LinkButton>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <StatCard
          label="Live Listings"
          value={liveListings?.count ?? 0}
          detail="Target: 500"
          tone="brand"
          icon={<Package className="h-4 w-4" strokeWidth={2} />}
          sparkline={listingSpark}
        />
        <StatCard
          label="Total Orders"
          value={totalOrders?.count ?? 0}
          tone="success"
          icon={<ShoppingBag className="h-4 w-4" strokeWidth={2} />}
        />
        <StatCard
          label="Total Revenue"
          value={`$${(revenueResult?.sum ?? 0).toFixed(2)}`}
          tone="success"
          icon={<DollarSign className="h-4 w-4" strokeWidth={2} />}
        />
        <StatCard
          label="Product Types"
          value={enabledProductCount}
          detail="of 16 enabled"
          tone="info"
          icon={<Boxes className="h-4 w-4" strokeWidth={2} />}
        />
        <StatCard
          label="Today's Spend"
          value={`$${(todayCost?.totalCost ?? 0).toFixed(2)}`}
          detail={`$${(todayCost?.maxDailyCost ?? 10).toFixed(2)} budget`}
          tone={costTone}
          icon={<Wallet className="h-4 w-4" strokeWidth={2} />}
          sparkline={costSpark}
        />
      </div>

      {/* Two-column: latest run + quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Latest run — 2 cols */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Latest Pipeline Run</CardTitle>
                <CardDescription>Most recent automation cycle</CardDescription>
              </div>
              {latestRun && <StatusBadge status={latestRun.status} />}
            </div>
          </CardHeader>
          <CardContent>
            {latestRun ? (
              <div className="space-y-4">
                {/* Progress */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-fg">
                      Step {latestRun.currentStep}/10
                      <span className="text-fg-subtle font-normal ml-2">{latestRun.currentStepName}</span>
                    </span>
                    <span className="text-xs tabular-nums text-fg-subtle">
                      {Math.round((latestRun.currentStep / 10) * 100)}%
                    </span>
                  </div>
                  <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        latestRun.status === "failed" ? "bg-danger" : "bg-brand"
                      }`}
                      style={{ width: `${(latestRun.currentStep / 10) * 100}%` }}
                    />
                  </div>
                </div>

                {latestRun.error && (
                  <div className="px-3 py-2 bg-danger-subtle text-danger text-sm rounded-lg">
                    {latestRun.error}
                  </div>
                )}

                <div className="flex items-center gap-4 text-xs text-fg-subtle flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Started {latestRun.startedAt ? new Date(latestRun.startedAt).toLocaleString() : "N/A"}
                  </div>
                  {latestRun.completedAt && (
                    <div className="flex items-center gap-1.5">
                      Completed {new Date(latestRun.completedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-fg-subtle">No pipeline runs yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Quick actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Jump to common tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/dashboard/pipeline" className="block">
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-hover transition-colors group">
                <div className="h-8 w-8 rounded-lg bg-brand-subtle text-brand flex items-center justify-center">
                  <Workflow className="h-4 w-4" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-fg">Pipeline</div>
                  <div className="text-xs text-fg-subtle">Trigger or monitor runs</div>
                </div>
                <ArrowRight className="h-4 w-4 text-fg-faint group-hover:text-brand transition-colors" />
              </div>
            </Link>
            <Link href="/dashboard/approvals" className="block">
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-hover transition-colors group">
                <div className="h-8 w-8 rounded-lg bg-success-subtle text-success flex items-center justify-center">
                  <CheckSquare className="h-4 w-4" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-fg">Approvals</div>
                  <div className="text-xs text-fg-subtle">Review pending listings</div>
                </div>
                <ArrowRight className="h-4 w-4 text-fg-faint group-hover:text-brand transition-colors" />
              </div>
            </Link>
            <Link href="/dashboard/settings" className="block">
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-hover transition-colors group">
                <div className="h-8 w-8 rounded-lg bg-surface-2 text-fg-subtle flex items-center justify-center">
                  <SettingsIcon className="h-4 w-4" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-fg">Settings</div>
                  <div className="text-xs text-fg-subtle">Budgets & integrations</div>
                </div>
                <ArrowRight className="h-4 w-4 text-fg-faint group-hover:text-brand transition-colors" />
              </div>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
