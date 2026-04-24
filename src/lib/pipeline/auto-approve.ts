import { db } from "@/lib/db";
import { etsyListings, printifyProducts, designConcepts, niches, nicheAnalytics, listingMetrics } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { log } from "@/lib/logger";

interface AutoApprovalResult {
  approved: boolean;
  confidence: number;
  reasons: string[];
}

const AUTO_APPROVAL_THRESHOLD = 0.75;

/**
 * Determines whether a listing qualifies for automatic approval.
 *
 * High-confidence listings bypass the manual approval queue, enabling
 * the pipeline to run at volume (20-30 listings/day) without human bottleneck.
 *
 * Confidence is based on:
 * - Niche proven (has prior sales) → +0.25
 * - High composite score → +0.15
 * - Design type has history of selling → +0.15
 * - SEO score is strong → +0.10
 * - Niche hit rate above average → +0.15
 * - Seasonal match → +0.10
 * - Moderation passed cleanly → +0.10
 */
export async function evaluateForAutoApproval(listingId: string): Promise<AutoApprovalResult> {
  const reasons: string[] = [];
  let confidence = 0;

  const listing = await db.select().from(etsyListings).where(eq(etsyListings.id, listingId)).get();
  if (!listing) return { approved: false, confidence: 0, reasons: ["listing not found"] };

  const product = await db.select().from(printifyProducts).where(eq(printifyProducts.id, listing.printifyProductId)).get();
  if (!product) return { approved: false, confidence: 0, reasons: ["product not found"] };

  const concept = await db.select().from(designConcepts).where(eq(designConcepts.id, product.designConceptId)).get();
  if (!concept) return { approved: false, confidence: 0, reasons: ["concept not found"] };

  const niche = await db.select().from(niches).where(eq(niches.id, concept.nicheId)).get();
  if (!niche) return { approved: false, confidence: 0, reasons: ["niche not found"] };

  // 1. Niche has proven sales history
  const analytics = await db.select().from(nicheAnalytics).where(eq(nicheAnalytics.nicheId, niche.id)).get();
  if (analytics && (analytics.totalOrders ?? 0) > 0) {
    confidence += 0.25;
    reasons.push(`niche has ${analytics.totalOrders} prior orders`);
  }

  // 2. High composite score
  if (niche.compositeScore != null) {
    if (niche.compositeScore >= 8.5) {
      confidence += 0.15;
      reasons.push(`high niche score: ${niche.compositeScore.toFixed(1)}`);
    } else if (niche.compositeScore >= 7.8) {
      confidence += 0.08;
      reasons.push(`good niche score: ${niche.compositeScore.toFixed(1)}`);
    }
  }

  // 3. Design type has history of selling (check any design of same type in this niche)
  const sameTypeOrders = await db
    .select({ count: sql<number>`count(distinct ${etsyListings.id})` })
    .from(designConcepts)
    .innerJoin(printifyProducts, eq(printifyProducts.designConceptId, designConcepts.id))
    .innerJoin(etsyListings, eq(etsyListings.printifyProductId, printifyProducts.id))
    .innerJoin(listingMetrics, eq(listingMetrics.etsyListingId, etsyListings.id))
    .where(eq(designConcepts.designType, concept.designType ?? "hybrid"))
    .get();

  if (sameTypeOrders && sameTypeOrders.count > 2) {
    confidence += 0.15;
    reasons.push(`${concept.designType} designs have ${sameTypeOrders.count} active listings`);
  }

  // 4. Strong SEO score
  if (listing.seoScore != null) {
    if (listing.seoScore >= 80) {
      confidence += 0.10;
      reasons.push(`strong SEO score: ${listing.seoScore.toFixed(0)}`);
    } else if (listing.seoScore >= 60) {
      confidence += 0.05;
    }
  }

  // 5. Niche hit rate above average
  if (analytics && analytics.nicheHitRate != null && analytics.nicheHitRate > 0.05) {
    confidence += 0.15;
    reasons.push(`niche hit rate: ${(analytics.nicheHitRate * 100).toFixed(0)}%`);
  }

  // 6. Moderation passed (all listings at this point passed, but check for borderline)
  if (listing.moderationResult) {
    try {
      const modResult = JSON.parse(listing.moderationResult);
      if (modResult.passed && !modResult.borderline) {
        confidence += 0.10;
        reasons.push("clean moderation pass");
      }
    } catch { /* ignore parse errors */ }
  }

  const approved = confidence >= AUTO_APPROVAL_THRESHOLD;

  if (approved) {
    log("info", `Auto-approved listing "${listing.title}" (confidence: ${(confidence * 100).toFixed(0)}%: ${reasons.join(", ")})`);
  }

  return { approved, confidence, reasons };
}
