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
  Menu,
  X,
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

function SidebarContent({
  pathname,
  budget,
  loggingOut,
  onLogout,
  onNavClick,
}: {
  pathname: string;
  budget: BudgetState | null;
  loggingOut: boolean;
  onLogout: () => void;
  onNavClick?: () => void;
}) {
  return (
    <>
      {/* Brand */}
      <div className="px-5 pt-5 pb-4">
        <Link href="/dashboard" className="flex items-center gap-2.5 group" onClick={onNavClick}>
          <div className="h-8 w-8 rounded-lg bg-brand flex items-center justify-center shadow-glow transition-transform duration-200 group-hover:scale-105">
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
        <div className="mx-3 mb-3 rounded-xl border border-border bg-surface-2/80 p-3 space-y-3">
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
      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavClick}
              className={`relative flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all duration-150 ${
                active
                  ? "bg-brand-subtle text-brand font-medium"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-brand" aria-hidden />
              )}
              <span className={`transition-colors ${active ? "text-brand" : "text-fg-subtle"}`}>{item.icon}</span>
              <span>{item.label}</span>
              {active && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border">
        <button
          onClick={onLogout}
          disabled={loggingOut}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-fg-muted hover:bg-danger-subtle/50 hover:text-danger rounded-lg transition-colors disabled:opacity-50"
        >
          <LogOut size={16} strokeWidth={1.75} />
          {loggingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [budget, setBudget] = useState<BudgetState | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

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

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const sharedProps = {
    pathname,
    budget,
    loggingOut,
    onLogout: handleLogout,
  };

  return (
    <>
      {/* Mobile header bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-surface/95 backdrop-blur-md border-b border-border flex items-center justify-between px-4 z-40">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-brand flex items-center justify-center">
            <Zap className="h-3.5 w-3.5 text-brand-fg" strokeWidth={2.5} fill="currentColor" />
          </div>
          <span className="text-sm font-bold text-fg">NeoPOD</span>
        </Link>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="h-9 w-9 flex items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-bg/60 backdrop-blur-sm z-40 animate-fade-in"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`lg:hidden fixed top-0 left-0 bottom-0 w-[280px] bg-surface border-r border-border flex flex-col z-50 transition-transform duration-300 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <SidebarContent {...sharedProps} onNavClick={() => setMobileOpen(false)} />
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-60 bg-surface border-r border-border min-h-screen flex-col sticky top-0">
        <SidebarContent {...sharedProps} />
      </aside>
    </>
  );
}
