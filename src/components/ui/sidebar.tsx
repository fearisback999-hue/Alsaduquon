"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-gray-900 text-white min-h-screen flex flex-col">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-bold">NeoPOD</h1>
        <p className="text-xs text-gray-400">Automation Engine</p>
      </div>
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
    </aside>
  );
}
