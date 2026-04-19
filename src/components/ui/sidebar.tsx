"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: "~" },
  { href: "/dashboard/pipeline", label: "Pipeline", icon: ">" },
  { href: "/dashboard/niches", label: "Niches", icon: "#" },
  { href: "/dashboard/designs", label: "Designs", icon: "*" },
  { href: "/dashboard/approvals", label: "Approvals", icon: "!" },
  { href: "/dashboard/listings", label: "Listings", icon: "=" },
  { href: "/dashboard/orders", label: "Orders", icon: "$" },
  { href: "/dashboard/costs", label: "Costs", icon: "%" },
  { href: "/dashboard/settings", label: "Settings", icon: "@" },
];

interface BudgetState {
  totalCost: number;
  maxDailyCost: number;
  listingsCreated: number;
  maxDailyListings: number;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [budget, setBudget] = useState<BudgetState | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/costs?days=1");
        if (!res.ok) return;
        const data = await res.json();
        const today = data.dailyCosts?.[0];
        if (today && !cancelled) {
          setBudget({
            totalCost: today.totalCost ?? 0,
            maxDailyCost: today.maxDailyCost ?? 10,
            listingsCreated: today.listingsCreated ?? 0,
            maxDailyListings: today.maxDailyListings ?? 5,
          });
        }
      } catch {
        // network error — leave widget hidden
      }
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pathname]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const costPct = budget ? Math.min(100, (budget.totalCost / budget.maxDailyCost) * 100) : 0;
  const listingsPct = budget ? Math.min(100, (budget.listingsCreated / budget.maxDailyListings) * 100) : 0;
  const costBarColor = costPct >= 90 ? "bg-red-500" : costPct >= 70 ? "bg-yellow-500" : "bg-green-500";
  const listingsBarColor = listingsPct >= 90 ? "bg-red-500" : "bg-blue-500";

  return (
    <aside className="w-56 bg-gray-900 text-white min-h-screen flex flex-col">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-bold">NeoPOD</h1>
        <p className="text-xs text-gray-400">Automation Engine</p>
      </div>

      {budget && (
        <div className="p-4 border-b border-gray-800 space-y-3">
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Today&apos;s spend</span>
              <span>${budget.totalCost.toFixed(2)} / ${budget.maxDailyCost.toFixed(2)}</span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className={`h-full ${costBarColor} transition-all`} style={{ width: `${costPct}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Listings today</span>
              <span>{budget.listingsCreated} / {budget.maxDailyListings}</span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className={`h-full ${listingsBarColor} transition-all`} style={{ width: `${listingsPct}%` }} />
            </div>
          </div>
        </div>
      )}

      <nav className="flex-1 py-4">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                active ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
            >
              <span className="w-5 text-center font-mono">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-800">
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded-md transition-colors disabled:opacity-50"
        >
          {loggingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </aside>
  );
}
