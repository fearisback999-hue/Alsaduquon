"use client";

import { useState, useEffect } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { getProductDisplayName } from "@/lib/printify/product-config";

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

export default function ListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    const params = new URLSearchParams({ limit: "50" });
    if (statusFilter) params.set("status", statusFilter);
    const res = await fetch(`/api/listings?${params}`);
    if (res.ok) {
      const data = await res.json();
      setListings(data.listings ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [statusFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Listings</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="approved">Approved</option>
          <option value="published">Published</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Title</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Product</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Price</th>
              <th className="text-right px-4 py-3 font-medium text-gray-500">Views</th>
              <th className="text-right px-4 py-3 font-medium text-gray-500">Favs</th>
              <th className="text-right px-4 py-3 font-medium text-gray-500">Sales</th>
              <th className="text-right px-4 py-3 font-medium text-gray-500">Conv%</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Link</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {listings.map((listing) => {
              const isZombie = (listing.views ?? 0) > 100 && (listing.sales ?? 0) === 0;
              return (
                <tr key={listing.id} className={`hover:bg-gray-50 ${isZombie ? "bg-red-50" : ""}`}>
                  <td className="px-4 py-3 font-medium max-w-xs truncate" title={listing.title}>
                    {listing.title}
                    {isZombie && <span className="ml-1 text-xs text-red-500" title="High views, zero sales">!</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{listing.productType ? getProductDisplayName(listing.productType) : "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={listing.status} /></td>
                  <td className="px-4 py-3">${listing.finalPrice.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{listing.views ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{listing.favorites ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-medium">{listing.sales ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    {listing.conversionRate != null
                      ? <span className={listing.conversionRate >= 2 ? "text-green-600 font-medium" : listing.conversionRate === 0 ? "text-gray-400" : "text-gray-600"}>{listing.conversionRate.toFixed(1)}%</span>
                      : "—"
                    }
                  </td>
                  <td className="px-4 py-3">
                    {listing.etsyUrl ? (
                      <a href={listing.etsyUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">
                        View
                      </a>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
            {listings.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">No listings found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
