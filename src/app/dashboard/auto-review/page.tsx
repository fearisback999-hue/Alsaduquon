"use client";

import { useState, useEffect } from "react";
import { X, Hash, DollarSign, Package, Inbox, Sparkles, AlertTriangle, ExternalLink, Eye } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getProductDisplayName } from "@/lib/printify/product-config";

interface QualityScores {
  composition?: number;
  text_legibility?: number;
  print_suitability?: number;
  commercial_appeal?: number;
  technical_quality?: number;
  overall_score?: number;
}

interface AutoEntry {
  id: string;
  reviewedAt: string;
  autoScore: number | null;
  feedback: string | null;
  isPublished: boolean;
  qualityScores: QualityScores | null;
  listing: { id: string; title: string; finalPrice: number; externalUrl: string | null; status: string; platform: string } | null;
  product: { productType: string } | null;
  niche: { name: string; compositeScore: number } | null;
  mockups: Array<{ storageUrl: string }>;
}

const DAY_OPTIONS = [1, 3, 7, 14, 30];

export default function AutoReviewPage() {
  const [entries, setEntries] = useState<AutoEntry[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const toast = useToast();

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/approvals/auto-review?days=${days}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
      } else {
        toast.error("Failed to load auto-approved listings");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [days]);

  async function rejectEntry(entryId: string) {
    setSubmitting(entryId);
    try {
      const res = await fetch("/api/approvals/auto-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, reason: reasons[entryId] }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(data.platformDeactivated ? `Rejected and deactivated on ${data.platform ?? "platform"}` : "Rejected");
        loadData();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Reject failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-44 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="page-header flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg tracking-tight">Auto-Approved Review</h1>
          <p className="text-sm text-fg-subtle mt-1">
            Quality-check designs the system approved without you. Reject anything that shouldn&apos;t have shipped.
          </p>
        </div>
        <div className="flex gap-1 bg-surface-2 rounded-lg p-1">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                days === d ? "bg-brand text-brand-fg" : "text-fg-muted hover:text-fg"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title="Nothing auto-approved in this window"
            description="When the pipeline auto-approves designs, they'll appear here for retroactive review."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((entry, idx) => {
            const q = entry.qualityScores;
            const lowText = q?.text_legibility != null && q.text_legibility < 8;
            const lowPrint = q?.print_suitability != null && q.print_suitability < 8;
            const flagged = lowText || lowPrint;

            return (
              <Card
                key={entry.id}
                className="p-4 animate-fade-in-up"
                hover
                style={{ animationDelay: `${Math.min(idx * 40, 320)}ms` }}
              >
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-28 h-28 sm:w-32 sm:h-32 bg-surface-2 rounded-lg overflow-hidden ring-1 ring-border relative group">
                    {entry.mockups[0]?.storageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={entry.mockups[0].storageUrl}
                        alt="Mockup"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-fg-faint">
                        <Sparkles className="h-5 w-5" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 mb-1">
                      <h3 className="font-semibold text-fg truncate flex-1">{entry.listing?.title ?? "Untitled"}</h3>
                      {flagged && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/10 text-warning text-[11px] font-medium">
                          <AlertTriangle className="h-3 w-3" /> low score
                        </span>
                      )}
                      {entry.isPublished && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 text-success text-[11px] font-medium">
                          <Eye className="h-3 w-3" /> live{entry.listing?.platform ? ` on ${entry.listing.platform}` : ""}
                        </span>
                      )}
                    </div>

                    {entry.niche && (
                      <p className="text-xs text-fg-subtle mb-2">
                        <span className="text-fg-faint">Niche:</span> {entry.niche.name}
                        {entry.niche.compositeScore != null && (
                          <span className="ml-2 tabular-nums">({entry.niche.compositeScore.toFixed(1)})</span>
                        )}
                      </p>
                    )}

                    {q && (
                      <div className="flex flex-wrap gap-2 mb-2 text-[11px]">
                        <ScoreChip label="overall" value={q.overall_score} />
                        <ScoreChip label="text" value={q.text_legibility} />
                        <ScoreChip label="print" value={q.print_suitability} />
                        <ScoreChip label="appeal" value={q.commercial_appeal} />
                        <ScoreChip label="tech" value={q.technical_quality} />
                      </div>
                    )}

                    <div className="flex items-center gap-4 text-xs text-fg-muted flex-wrap">
                      <span className="flex items-center gap-1 tabular-nums">
                        <DollarSign className="h-3 w-3 text-fg-faint" />
                        {entry.listing?.finalPrice?.toFixed(2) ?? "0.00"}
                      </span>
                      {entry.product?.productType && (
                        <span className="flex items-center gap-1">
                          <Package className="h-3 w-3 text-fg-faint" />
                          {getProductDisplayName(entry.product.productType)}
                        </span>
                      )}
                      {entry.autoScore != null && (
                        <span className="flex items-center gap-1 tabular-nums">
                          <Hash className="h-3 w-3 text-fg-faint" />
                          confidence {(entry.autoScore * 100).toFixed(0)}%
                        </span>
                      )}
                      <span className="text-fg-faint">
                        {new Date(entry.reviewedAt).toLocaleString()}
                      </span>
                      {entry.listing?.externalUrl && (
                        <a
                          href={entry.listing.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-brand hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" /> view{entry.listing?.platform ? ` on ${entry.listing.platform}` : ""}
                        </a>
                      )}
                    </div>

                    <input
                      type="text"
                      placeholder="Reject reason (optional)"
                      maxLength={500}
                      value={reasons[entry.id] ?? ""}
                      onChange={(e) => setReasons({ ...reasons, [entry.id]: e.target.value })}
                      className="mt-3 w-full px-3 py-1.5 bg-surface border border-border rounded-lg text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all"
                    />
                  </div>

                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => rejectEntry(entry.id)}
                      disabled={submitting === entry.id}
                      leftIcon={<X className="h-3.5 w-3.5" />}
                    >
                      {entry.isPublished ? "Reject & deactivate" : "Reject"}
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

function ScoreChip({ label, value }: { label: string; value: number | undefined }) {
  if (value == null) return null;
  const tone = value >= 8 ? "bg-success/10 text-success" : value >= 6 ? "bg-surface-2 text-fg-muted" : "bg-warning/10 text-warning";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${tone} tabular-nums`}>
      {label} {value.toFixed(1)}
    </span>
  );
}
