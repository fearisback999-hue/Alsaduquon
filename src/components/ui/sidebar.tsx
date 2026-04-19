"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Workflow,
  Hash,
  Sparkles,
  CheckSquare,
  ListChecks,
  ShoppingBag,
  Wallet,
  Settings,
  LogOut,
  Zap,
} from "lucide-react";
import { DualProgress } from "./progress";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const ICON_PROPS = { size: 16, strokeWidth: 1.75 } as const;

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: <LayoutDashboard {...ICON_PROPS} /> },
  { href: "/dashboard/pipeline", label: "Pipeline", icon: <Workflow {...ICON_PROPS} /> },
  { href: "/dashboard/niches", label: "Niches", icon: <Hash {...ICON_PROPS} /> },
  { href: "/dashboard/designs", label: "Designs", icon: <Sparkles {...ICON_PROPS} /> },
  { href: "/dashboard/approvals", label: "Approvals", icon: <CheckSquare {...ICON_PROPS} /> },
  { href: "/dashboard/listings", label: "Listings", icon: <ListChecks {...ICON_PROPS} /> },
  { href: "/dashboard/orders", label: "Orders", icon: <ShoppingBag {...ICON_PROPS} /> },
  { href: "/dashboard/costs", label: "Costs", icon: <Wallet {...ICON_PROPS} /> },
  { href: "/dashboard/settings", label: "Settings", icon: <Settings {...ICON_PROPS} /> },
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

  return (
    <aside className="w-60 bg-surface border-r border-border min-h-screen flex flex-col sticky top-0">
      {/* Brand */}
      <div className="px-5 pt-5 pb-4">
        <Link href="/dashboard" className="flex items-center gap-2.5 group">
          <div className="h-8 w-8 rounded-lg bg-brand flex items-center justify-center shadow-glow transition-transform group-hover:scale-105">
            <Zap className="h-4 w-4 text-brand-fg" strokeWidth={2.5} fill="currentColor" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-fg">NeoPOD</div>
            <div className="text-[10px] uppercase tracking-wider text-fg-faint font-medium">Automation Engine</div>
          </div>
        </Link>
      </div>

      {/* Budget widget */}
      {budget && (
        <div className="mx-3 mb-3 rounded-xl border border-border bg-surface-2 p-3 space-y-3">
          <DualProgress
            label="Spend today"
            current={budget.totalCost}
            max={budget.maxDailyCost}
            formatter={(v) => `$${v.toFixed(2)}`}
          />
          <DualProgress
            label="Listings"
            current={budget.listingsCreated}
            max={budget.maxDailyListings}
          />
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all duration-150 ${
                active
                  ? "bg-brand-subtle text-brand font-medium"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-brand" aria-hidden />
              )}
              <span className={active ? "text-brand" : "text-fg-subtle"}>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border">
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg rounded-lg transition-colors disabled:opacity-50"
        >
          <LogOut size={16} strokeWidth={1.75} />
          {loggingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </aside>
  );
}
