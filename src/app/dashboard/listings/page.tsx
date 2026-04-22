"use client";

import { useState, useMemo } from "react";
import { ListChecks, ExternalLink, AlertTriangle, Filter, TrendingUp } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { getProductDisplayName } from "@/lib/printify/product-config";
import { useApiData } from "@/lib/hooks/use-api-data";

interface Listing {
  id: string;
  title: string;
  status: string;
  finalPrice: number;
  etsyUrl: string | null;
  seoScore: number | null;
  publishedAt: string | null;
  createdAt: string;
  productType: string | null;
  views: number | null;
  favorites: number | null;
  sales: number | null;
  conversionRate: number | null;
}

const FILTERS = [
  { value: "", label: "All" },
  { value: "published", label: "Published" },
  { value: "pending_approval", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "draft", label: "Draft" },
  { value: "rejected", label: "Rejected" },
];

const LIMIT = 50;

export default function ListingsPage() {
  const [statusFilter, setStatusFilter] = useState("");
  const url = `/api/listings?${new URLSearchParams({
    limit: String(LIMIT),
    ...(statusFilter ? { status: statusFilter } : {}),
  })}`;
  const { data, loading, error, refetch } = useApiData<{ listings: Listing[] }>(url);
  const listings = useMemo(() => data?.listings ?? [], [data]);

  const zombieCount = listings.filter((l) => (l.views ?? 0) > 100 && (l.sales ?? 0) === 0).length;
  const truncated = listings.length >= LIMIT;

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="page-header flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg tracking-tight">Listings</h1>
          <p className="text-sm text-fg-subtle mt-1">
            {truncated ? `Showing ${listings.length} most recent` : `${listings.length} listing${listings.length === 1 ? "" : "s"}`}
            {zombieCount > 0 && (
              <> · <span className="text-danger font-medium">{zombieCount} zombie{zombieCount === 1 ? "" : "s"}</span></>
            )}
          </p>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Filter by status">
        <Filter className="h-3.5 w-3.5 text-fg-faint" aria-hidden />
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            aria-pressed={statusFilter === f.value}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              statusFilter === f.value
                ? "bg-brand text-brand-fg"
                : "bg-surface-2 text-fg-muted hover:bg-surface-hover hover:text-fg"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={refetch} retrying={loading} />
      ) : loading ? (
        <Skeleton className="h-64 w-full" />
      ) : listings.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ListChecks className="h-6 w-6" />}
            title="No listings found"
            description="Listings published by the pipeline will appear here with performance metrics."
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-y border-border">
                <tr className="text-left">
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Title</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Product</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle">Status</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">Price</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">Views</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">Favs</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">Sales</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle text-right tabular-nums">Conv.</th>
                  <th className="px-5 py-2.5 font-medium text-xs uppercase tracking-wide text-fg-subtle"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {listings.map((listing) => {
                  const isZombie = (listing.views ?? 0) > 100 && (listing.sales ?? 0) === 0;
                  const conversionIsGood = (listing.conversionRate ?? 0) >= 2;
                  return (
                    <tr
                      key={listing.id}
                      className={`transition-colors ${
                        isZombie ? "bg-danger-subtle/30 hover:bg-danger-subtle/50" : "hover:bg-surface-hover"
                      }`}
                    >
                      <td className="px-5 py-3 max-w-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-fg truncate" title={listing.title}>{listing.title}</span>
                          {isZombie && (
                            <span title="High views, zero sales" className="flex-shrink-0 text-danger">
                              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.25} />
                            </span>
                          )}
                        </div>
                        {listing.seoScore != null && (
                          <div className="text-[10px] text-fg-faint mt-0.5">SEO {listing.seoScore}/100</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-fg-muted text-xs">
                        {listing.productType ? getProductDisplayName(listing.productType) : "—"}
                      </td>
                      <td className="px-5 py-3"><StatusBadge status={listing.status} /></td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium text-fg">${listing.finalPrice.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-fg-muted">{listing.views?.toLocaleString() ?? "—"}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-fg-muted">{listing.favorites?.toLocaleString() ?? "—"}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium text-fg">{listing.sales ?? "—"}</td>
                      <td className="px-5 py-3 text-right">
                        {listing.conversionRate != null ? (
                          <span
                            className={`inline-flex items-center gap-1 tabular-nums text-xs font-medium ${
                              conversionIsGood ? "text-success" : listing.conversionRate === 0 ? "text-fg-faint" : "text-fg-muted"
                            }`}
                          >
                            {conversionIsGood && <TrendingUp className="h-3 w-3" strokeWidth={2.25} />}
                            {listing.conversionRate.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-fg-faint">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {listing.etsyUrl ? (
                          <a
                            href={listing.etsyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-brand hover:text-brand-hover text-xs font-medium transition-colors"
                          >
                            View
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-fg-faint">—</span>
                        )}
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
