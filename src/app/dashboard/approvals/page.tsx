"use client";

import { useState, useEffect } from "react";
import { Check, X, Hash, Tag, DollarSign, Package, Inbox, Sparkles } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
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
  const toast = useToast();

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch("/api/approvals");
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
      } else {
        toast.error("Failed to load approvals");
      }
    } catch {
      toast.error("Network error loading approvals");
    } finally {
      setLoading(false);
    }
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

    try {
      const res = await fetch("/api/approvals/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvals }),
      });
      if (res.ok) {
        const verb = action === "approved" ? "Approved" : "Rejected";
        toast.success(`${verb} ${targets.length} listing${targets.length === 1 ? "" : "s"}`);
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Action failed");
      }
    } catch {
      toast.error("Network error submitting approvals");
    } finally {
      setSubmitting(false);
      loadData();
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="page-header flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg tracking-tight">Approval Queue</h1>
          <p className="text-sm text-fg-subtle mt-1">
            {entries.length > 0
              ? `${entries.length} listing${entries.length === 1 ? "" : "s"} awaiting your review.`
              : "All caught up — nothing pending."}
          </p>
        </div>
        {entries.length > 0 && (
          <div className="flex gap-2">
            <Button
              variant="success"
              onClick={() => handleBatchAction("approved")}
              disabled={submitting}
              leftIcon={<Check className="h-4 w-4" />}
            >
              Approve all ({entries.length})
            </Button>
            <Button
              variant="danger"
              onClick={() => handleBatchAction("rejected")}
              disabled={submitting}
              leftIcon={<X className="h-4 w-4" />}
            >
              Reject all
            </Button>
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title="No listings pending approval"
            description="When the pipeline completes a batch, new listings will appear here for your review."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((entry, idx) => {
            let tags: string[] = [];
            try {
              tags = entry.listing?.tags ? JSON.parse(entry.listing.tags) : [];
            } catch {
              tags = [];
            }
            return (
              <Card
                key={entry.id}
                className="p-4 animate-fade-in-up"
                hover
                style={{ animationDelay: `${Math.min(idx * 40, 320)}ms` }}
              >
                <div className="flex gap-4">
                  {/* Mockup */}
                  <div className="flex-shrink-0 w-28 h-28 sm:w-32 sm:h-32 bg-surface-2 rounded-lg overflow-hidden ring-1 ring-border relative group">
                    {entry.mockups[0]?.storageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={entry.mockups[0].storageUrl}
                        alt={`Mockup for ${entry.listing?.title ?? "listing"}`}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-fg-faint">
                        <Sparkles className="h-5 w-5" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 mb-1">
                      <h3 className="font-semibold text-fg truncate flex-1">{entry.listing?.title ?? "Untitled"}</h3>
                      <StatusBadge status={entry.status} />
                    </div>

                    {entry.niche && (
                      <p className="text-xs text-fg-subtle mb-2">
                        <span className="text-fg-faint">Niche:</span> {entry.niche.name}
                        {entry.niche.compositeScore != null && (
                          <span className="ml-2 tabular-nums">
                            ({entry.niche.compositeScore.toFixed(1)})
                          </span>
                        )}
                      </p>
                    )}

                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {tags.slice(0, 8).map((tag, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-surface-2 text-fg-muted rounded text-[11px]"
                          >
                            <Hash className="h-2.5 w-2.5 text-fg-faint" />
                            {tag}
                          </span>
                        ))}
                        {tags.length > 8 && (
                          <span className="text-[11px] text-fg-faint px-1.5 py-0.5">+{tags.length - 8}</span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-4 text-xs text-fg-muted flex-wrap">
                      <span className="flex items-center gap-1 tabular-nums">
                        <DollarSign className="h-3 w-3 text-fg-faint" />
                        {entry.listing?.finalPrice?.toFixed(2) ?? "0.00"}
                      </span>
                      {entry.listing?.seoScore != null && (
                        <span className="flex items-center gap-1 tabular-nums">
                          <Tag className="h-3 w-3 text-fg-faint" />
                          SEO {entry.listing.seoScore}/100
                        </span>
                      )}
                      {entry.product?.productType && (
                        <span className="flex items-center gap-1">
                          <Package className="h-3 w-3 text-fg-faint" />
                          {getProductDisplayName(entry.product.productType)}
                        </span>
                      )}
                      <span className="text-fg-faint">Batch #{entry.batchNumber}</span>
                    </div>

                    <input
                      type="text"
                      placeholder="Feedback (optional)"
                      aria-label={`Feedback for ${entry.listing?.title ?? "listing"}`}
                      maxLength={500}
                      value={feedback[entry.id] ?? ""}
                      onChange={(e) => setFeedback({ ...feedback, [entry.id]: e.target.value })}
                      className="mt-3 w-full px-3 py-1.5 bg-surface border border-border rounded-lg text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all"
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="success"
                      onClick={() => handleBatchAction("approved", [entry.id])}
                      disabled={submitting}
                      leftIcon={<Check className="h-3.5 w-3.5" />}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleBatchAction("rejected", [entry.id])}
                      disabled={submitting}
                      leftIcon={<X className="h-3.5 w-3.5" />}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
