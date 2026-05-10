import { db } from "@/lib/db";
import {
  listings,
  orders,
  niches,
  pipelineRuns,
  dailyCosts,
  nicheLearningWeights,
  customerReviews,
  settings,
} from "@/lib/db/schema";
import { eq, sql, desc, gte, and } from "drizzle-orm";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { forecastAnnualRevenue } from "@/lib/analytics/revenue-forecast";
import {
  TrendingUp,
  Target,
  Trophy,
  Activity,
  Brain,
  Star,
  Package,
  DollarSign,
} from "lucide-react";

export const dynamic = "force-dynamic";

const DEFAULT_GOAL = 150_000;

export default async function MetricsPage() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const thirtyDaysAgoDate = new Date(Date.now() - 30 * 86400_000).toISOString().split("T")[0];

  const [
    revenueAllTime,
    revenueMonth,
    revenueYear,
    revenueWeek,
    profitAllTime,
    totalOrders,
    livelistings,
    totalListings,
    activeNiches,
    pendingApproval,
    pipelinesAllTime,
    pipelinesThisMonth,
    learnedWeights,
    topNiches,
    flaggedReviews,
    avgRating,
    monthlyCosts,
    goalSetting,
    targetCarSetting,
    forecast,
  ] = await Promise.all([
    db.select({ sum: sql<number>`coalesce(sum(revenue), 0)` }).from(orders).get(),
    db.select({ sum: sql<number>`coalesce(sum(revenue), 0)` }).from(orders).where(gte(orders.orderedAt, startOfMonth)).get(),
    db.select({ sum: sql<number>`coalesce(sum(revenue), 0)` }).from(orders).where(gte(orders.orderedAt, startOfYear)).get(),
    db.select({ sum: sql<number>`coalesce(sum(revenue), 0)` }).from(orders).where(gte(orders.orderedAt, sevenDaysAgo)).get(),
    db.select({ sum: sql<number>`coalesce(sum(profit), 0)` }).from(orders).get(),
    db.select({ count: sql<number>`count(*)` }).from(orders).get(),
    db.select({ count: sql<number>`count(*)` }).from(listings).where(eq(listings.status, "published")).get(),
    db.select({ count: sql<number>`count(*)` }).from(listings).get(),
    db.select({ count: sql<number>`count(*)` }).from(niches).where(eq(niches.status, "active")).get(),
    db.select({ count: sql<number>`count(*)` }).from(listings).where(eq(listings.status, "pending_approval")).get(),
    db.select({ count: sql<number>`count(*)` }).from(pipelineRuns).get(),
    db.select({ count: sql<number>`count(*)` }).from(pipelineRuns).where(gte(pipelineRuns.createdAt, startOfMonth)).get(),
    db.select().from(nicheLearningWeights).all(),
    db.select({
      id: niches.id,
      name: niches.name,
      compositeScore: niches.compositeScore,
      velocityScore: niches.velocityScore,
      triangulationScore: niches.triangulationScore,
    })
      .from(niches)
      .where(eq(niches.status, "active"))
      .orderBy(desc(niches.compositeScore))
      .limit(8)
      .all(),
    db.select({ count: sql<number>`count(*)` }).from(customerReviews).where(eq(customerReviews.qualityIssue, true)).get(),
    db.select({ avg: sql<number>`coalesce(avg(rating), 0)` }).from(customerReviews).get(),
    db.select({ sum: sql<number>`coalesce(sum(total_cost), 0)` }).from(dailyCosts).where(gte(dailyCosts.date, thirtyDaysAgoDate)).get(),
    db.select().from(settings).where(eq(settings.key, "annual_revenue_goal")).get(),
    db.select().from(settings).where(eq(settings.key, "target_car_price")).get(),
    forecastAnnualRevenue().catch(() => ({ projectedAnnual: 0, confidence: "low", method: "no_data", monthlyTrend: [] })),
  ]);

  const totalRevenue = revenueAllTime?.sum ?? 0;
  const totalProfit = profitAllTime?.sum ?? 0;
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
  const monthRevenue = revenueMonth?.sum ?? 0;
  const yearRevenue = revenueYear?.sum ?? 0;
  const weekRevenue = revenueWeek?.sum ?? 0;

  const annualGoal = goalSetting ? parseFloat(goalSetting.value) || DEFAULT_GOAL : DEFAULT_GOAL;
  const carGoal = targetCarSetting ? parseFloat(targetCarSetting.value) || 0 : 0;

  const projected = forecast.projectedAnnual;
  const goalProgress = annualGoal > 0 ? (yearRevenue / annualGoal) * 100 : 0;
  const projectedGoalProgress = annualGoal > 0 ? (projected / annualGoal) * 100 : 0;

  // Days remaining in year
  const endOfYear = new Date(now.getFullYear(), 11, 31).getTime();
  const daysLeftInYear = Math.max(1, Math.ceil((endOfYear - now.getTime()) / 86400_000));
  const dailyPaceNeeded = annualGoal > 0 ? Math.max(0, (annualGoal - yearRevenue) / daysLeftInYear) : 0;

  // Conversion rate proxy
  const totalListingsCount = totalListings?.count ?? 0;
  const liveCount = livelistings?.count ?? 0;
  const ordersCount = totalOrders?.count ?? 0;
  const conversionProxy = liveCount > 0 ? (ordersCount / liveCount) * 100 : 0;

  // Reviews
  const flaggedCount = flaggedReviews?.count ?? 0;
  const ratingAvg = avgRating?.avg ?? 0;

  // Costs vs revenue (last 30 days)
  const monthCostTotal = monthlyCosts?.sum ?? 0;
  const monthRevTotal = revenueMonth?.sum ?? 0;
  const monthNet = monthRevTotal - monthCostTotal;

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="page-header">
        <h1 className="text-2xl font-bold text-fg tracking-tight">Metrics &amp; Goals</h1>
        <p className="text-sm text-fg-subtle mt-1">
          Everything you&apos;re tracking — performance, intelligence, goals — in one place.
        </p>
      </div>

      {/* GOALS BLOCK */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg-subtle uppercase tracking-wider">Goals</h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Annual revenue goal */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><Target className="h-4 w-4 text-brand" /> Annual Revenue Goal</CardTitle>
                  <CardDescription>${annualGoal.toLocaleString()} target for {now.getFullYear()}</CardDescription>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold tabular-nums text-fg">${yearRevenue.toFixed(0)}</div>
                  <div className="text-xs text-fg-subtle">{goalProgress.toFixed(1)}% complete</div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-3 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    goalProgress >= 75 ? "bg-success" : goalProgress >= 25 ? "bg-brand" : "bg-info"
                  }`}
                  style={{ width: `${Math.min(100, goalProgress)}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-fg-faint uppercase tracking-wider">Projected</div>
                  <div className="text-fg font-semibold tabular-nums">${projected.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                  <div className="text-fg-subtle">{projectedGoalProgress.toFixed(0)}% of goal</div>
                </div>
                <div>
                  <div className="text-fg-faint uppercase tracking-wider">Days left</div>
                  <div className="text-fg font-semibold tabular-nums">{daysLeftInYear}</div>
                  <div className="text-fg-subtle">in {now.getFullYear()}</div>
                </div>
                <div>
                  <div className="text-fg-faint uppercase tracking-wider">Daily pace needed</div>
                  <div className="text-fg font-semibold tabular-nums">${dailyPaceNeeded.toFixed(0)}</div>
                  <div className="text-fg-subtle">to hit goal</div>
                </div>
              </div>
              <div className="text-xs text-fg-subtle">
                Forecast confidence: <span className="font-medium text-fg">{forecast.confidence}</span> — {forecast.method.replace(/_/g, " ")}
              </div>
            </CardContent>
          </Card>

          {/* Car / personal target */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><Trophy className="h-4 w-4 text-warning" /> Personal Target</CardTitle>
                  <CardDescription>{carGoal > 0 ? `$${carGoal.toLocaleString()} target` : "Set a goal in Settings (target_car_price)"}</CardDescription>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold tabular-nums text-fg">${totalProfit.toFixed(0)}</div>
                  <div className="text-xs text-fg-subtle">profit so far</div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {carGoal > 0 ? (
                <>
                  <div className="h-3 bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-warning transition-all duration-700"
                      style={{ width: `${Math.min(100, (totalProfit / carGoal) * 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-fg-subtle">
                    {((totalProfit / carGoal) * 100).toFixed(1)}% of the way there. ${(carGoal - totalProfit).toFixed(0)} to go.
                  </div>
                </>
              ) : (
                <div className="text-xs text-fg-subtle">
                  Add a row to settings with key <code className="text-fg font-mono">target_car_price</code> to track personal goal progress here.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* PERFORMANCE BLOCK */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg-subtle uppercase tracking-wider">Performance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Last 7d" value={`$${weekRevenue.toFixed(0)}`} tone="brand" icon={<DollarSign className="h-4 w-4" />} />
          <StatCard label="This month" value={`$${monthRevenue.toFixed(0)}`} tone="success" icon={<TrendingUp className="h-4 w-4" />} />
          <StatCard label="This year" value={`$${yearRevenue.toFixed(0)}`} tone="success" icon={<TrendingUp className="h-4 w-4" />} />
          <StatCard label="All-time" value={`$${totalRevenue.toFixed(0)}`} tone="brand" icon={<DollarSign className="h-4 w-4" />} />
          <StatCard label="Total profit" value={`$${totalProfit.toFixed(0)}`} detail={`${margin.toFixed(1)}% margin`} tone={totalProfit >= 0 ? "success" : "danger"} icon={<TrendingUp className="h-4 w-4" />} />
          <StatCard label="Net (30d)" value={`$${monthNet.toFixed(0)}`} detail={`spend $${monthCostTotal.toFixed(0)}`} tone={monthNet >= 0 ? "success" : "danger"} icon={<Activity className="h-4 w-4" />} />
        </div>
      </section>

      {/* CATALOG BLOCK */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg-subtle uppercase tracking-wider">Catalog &amp; Pipeline</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Live listings" value={liveCount} detail={`${totalListingsCount} total`} tone="brand" icon={<Package className="h-4 w-4" />} />
          <StatCard label="Active niches" value={activeNiches?.count ?? 0} tone="success" icon={<Activity className="h-4 w-4" />} />
          <StatCard label="Pending approval" value={pendingApproval?.count ?? 0} tone={(pendingApproval?.count ?? 0) > 0 ? "warning" : "neutral"} icon={<Activity className="h-4 w-4" />} />
          <StatCard label="Total orders" value={ordersCount} tone="success" icon={<Package className="h-4 w-4" />} />
          <StatCard label="Pipeline runs" value={pipelinesAllTime?.count ?? 0} detail={`${pipelinesThisMonth?.count ?? 0} this month`} tone="info" icon={<Activity className="h-4 w-4" />} />
          <StatCard label="Order rate" value={`${conversionProxy.toFixed(2)}%`} detail="orders / live listing" tone="brand" icon={<TrendingUp className="h-4 w-4" />} />
        </div>
      </section>

      {/* INTELLIGENCE BLOCK */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Learned weights */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Brain className="h-4 w-4 text-info" /> Learned Scoring Weights</CardTitle>
            <CardDescription>
              {learnedWeights.length > 0
                ? "Live weights trained from your sales outcomes"
                : "Defaults — train via the analytics cron after first orders"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {learnedWeights.length > 0 ? (
              <div className="space-y-2">
                {learnedWeights
                  .sort((a, b) => b.weight - a.weight)
                  .map((w) => (
                    <div key={w.id} className="flex items-center gap-3">
                      <span className="text-sm text-fg w-32 capitalize">{w.metric.replace(/_/g, " ")}</span>
                      <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
                        <div className="h-full bg-info rounded-full" style={{ width: `${Math.min(100, w.weight * 100)}%` }} />
                      </div>
                      <span className="text-xs tabular-nums text-fg-subtle w-16 text-right">{(w.weight * 100).toFixed(1)}%</span>
                      <span className="text-xs tabular-nums text-fg-faint w-14 text-right">
                        r={w.correlation?.toFixed(2) ?? "—"}
                      </span>
                    </div>
                  ))}
                <div className="text-xs text-fg-subtle pt-1">
                  Last trained: {new Date(learnedWeights[0].lastTrainedAt).toLocaleDateString()} on {learnedWeights[0].sampleSize} niches
                </div>
              </div>
            ) : (
              <div className="text-sm text-fg-subtle">
                Need at least 15 scored niches with order outcomes before training can begin. Default weights are in use.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top niches */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Star className="h-4 w-4 text-warning" /> Top Active Niches</CardTitle>
            <CardDescription>Highest composite score, with velocity &amp; triangulation</CardDescription>
          </CardHeader>
          <CardContent>
            {topNiches.length > 0 ? (
              <div className="space-y-2">
                {topNiches.map((n, i) => (
                  <div key={n.id} className="flex items-center gap-3 text-sm">
                    <span className="text-fg-faint tabular-nums w-5">{i + 1}.</span>
                    <span className="text-fg flex-1 truncate">{n.name}</span>
                    <span className="text-xs tabular-nums text-fg-subtle w-12 text-right">{(n.compositeScore ?? 0).toFixed(1)}</span>
                    <span className="text-xs tabular-nums text-info w-12 text-right">v{(n.velocityScore ?? 0).toFixed(1)}</span>
                    <span className="text-xs tabular-nums text-success w-12 text-right">t{(n.triangulationScore ?? 0).toFixed(0)}</span>
                  </div>
                ))}
                <div className="text-xs text-fg-faint pt-2">
                  composite · v=velocity · t=triangulation
                </div>
              </div>
            ) : (
              <div className="text-sm text-fg-subtle">No active niches yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* QUALITY BLOCK */}
      <section>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Star className="h-4 w-4 text-success" /> Customer Quality</CardTitle>
            <CardDescription>Reviews and quality issues from synced orders</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-2xl font-bold text-fg tabular-nums">{ratingAvg.toFixed(2)}</div>
                <div className="text-xs text-fg-subtle">Average rating</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-fg tabular-nums">{flaggedCount}</div>
                <div className="text-xs text-fg-subtle">Flagged reviews</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-fg tabular-nums">${ordersCount > 0 ? (totalRevenue / ordersCount).toFixed(2) : "0.00"}</div>
                <div className="text-xs text-fg-subtle">Avg order value</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-fg tabular-nums">${ordersCount > 0 ? (totalProfit / ordersCount).toFixed(2) : "0.00"}</div>
                <div className="text-xs text-fg-subtle">Avg profit / order</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
