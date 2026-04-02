"use client";

import { useState, useEffect } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { getProductDisplayName } from "@/lib/printify/product-config";

interface ApprovalEntry {
  id: string;
  status: string;
  batchNumber: number;
  listing: { id: string; title: string; description: string; tags: string; finalPrice: number; seoScore: number } | null;
  product: { productType: string; title: string } | null;
  mockups: Array<{ storageUrl: string; mockupType: string }>;
  concept: { title: string; description: string } | null;
  niche: { name: string; compositeScore: number } | null;
}

export default function ApprovalsPage() {
  const [entries, setEntries] = useState<ApprovalEntry[]>([]);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    const res = await fetch("/api/approvals");
    if (res.ok) {
      const data = await res.json();
      setEntries(data.entries ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function handleBatchAction(action: "approved" | "rejected", ids?: string[]) {
    setSubmitting(true);
    const targets = ids ?? entries.map((e) => e.id);
    const approvals = targets.map((id) => ({
      id,
      action,
      feedback: feedback[id] ?? undefined,
    }));

    await fetch("/api/approvals/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvals }),
    });

    setSubmitting(false);
    loadData();
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Loading approvals...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Approval Queue</h1>
        {entries.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={() => handleBatchAction("approved")}
              disabled={submitting}
              className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 disabled:opacity-50"
            >
              Approve All ({entries.length})
            </button>
            <button
              onClick={() => handleBatchAction("rejected")}
              disabled={submitting}
              className="px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 disabled:opacity-50"
            >
              Reject All
            </button>
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
          No listings pending approval.
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <div key={entry.id} className="bg-white rounded-lg border p-4">
              <div className="flex gap-4">
                {/* Mockup preview */}
                <div className="flex-shrink-0 w-32 h-32 bg-gray-100 rounded overflow-hidden">
                  {entry.mockups[0]?.storageUrl ? (
                    <img src={entry.mockups[0].storageUrl} alt="Mockup" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">No mockup</div>
                  )}
                </div>

                {/* Listing info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-gray-900 truncate">{entry.listing?.title ?? "Untitled"}</h3>
                    <StatusBadge status={entry.status} />
                  </div>

                  {entry.niche && (
                    <p className="text-xs text-gray-500 mb-1">
                      Niche: {entry.niche.name} (score: {entry.niche.compositeScore?.toFixed(1)})
                    </p>
                  )}

                  {entry.listing?.tags && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {(() => { try { return JSON.parse(entry.listing.tags); } catch { return []; } })().slice(0, 8).map((tag: string, i: number) => (
                        <span key={i} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{tag}</span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span>${entry.listing?.finalPrice?.toFixed(2) ?? "0.00"}</span>
                    {entry.listing?.seoScore != null && <span>SEO: {entry.listing.seoScore}/100</span>}
                    <span>{entry.product?.productType ? getProductDisplayName(entry.product.productType) : ""}</span>
                    <span>Batch #{entry.batchNumber}</span>
                  </div>

                  {/* Feedback input */}
                  <input
                    type="text"
                    placeholder="Feedback (optional)"
                    maxLength={500}
                    value={feedback[entry.id] ?? ""}
                    onChange={(e) => setFeedback({ ...feedback, [entry.id]: e.target.value })}
                    className="mt-2 w-full px-3 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* Action buttons */}
                <div className="flex flex-col gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleBatchAction("approved", [entry.id])}
                    disabled={submitting}
                    className="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleBatchAction("rejected", [entry.id])}
                    disabled={submitting}
                    className="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
