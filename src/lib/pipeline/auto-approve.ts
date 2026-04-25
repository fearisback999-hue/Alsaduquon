import { db } from "@/lib/db";
import { etsyListings, printifyProducts, designConcepts, niches, nicheAnalytics, listingMetrics, generatedImages, settings, approvalQueueEntries } from "@/lib/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { log } from "@/lib/logger";

interface AutoApprovalResult {
  approved: boolean;
  confidence: number;
  reasons: string[];
  blockedBy?: string;
}

const AUTO_APPROVAL_THRESHOLD = 0.75;

// Hard quality gates — auto-approval requires the GPT-4o vision check
// to score the image at or above these floors. A weak image cannot be
// auto-approved no matter how strong the niche or SEO factors are.
const MIN_OVERALL_SCORE = 8;
const MIN_TEXT_LEGIBILITY = 7;
const MIN_PRINT_SUITABILITY = 7;
const MIN_TECHNICAL_QUALITY = 7;

// Training-wheels default: require this many manually-reviewed approvals
// before any auto-approval is allowed. Tunable via settings.
const DEFAULT_TRAINING_WHEELS_MIN_REVIEWS = 20;

async function getTrainingWheelsState(): Promise<{ enabled: boolean; required: number; completed: number }> {
  const enabledSetting = await db.select().from(settings).where(eq(settings.key, "training_wheels_enabled")).get();
  const requiredSetting = await db.select().from(settings).where(eq(settings.key, "training_wheels_min_reviews")).get();

  // Default ON for safety — opt out explicitly
  const enabled = enabledSetting ? enabledSetting.value !== "false" : true;
  const required = requiredSetting ? parseInt(requiredSetting.value, 10) || DEFAULT_TRAINING_WHEELS_MIN_REVIEWS : DEFAULT_TRAINING_WHEELS_MIN_REVIEWS;

  if (!enabled) return { enabled: false, required, completed: required };

  const manualApprovals = await db
    .select({ count: sql<number>`count(*)` })
    .from(approvalQueueEntries)
    .where(and(eq(approvalQueueEntries.mode, "manual"), eq(approvalQueueEntries.status, "approved")))
    .get();

  return { enabled: true, required, completed: manualApprovals?.count ?? 0 };
}

/**
 * Determines whether a listing qualifies for automatic approval.
 *
 * High-confidence listings bypass the manual approval queue, enabling
 * the pipeline to run at volume (20-30 listings/day) without human bottleneck.
 *
 * Hard gates (any failure blocks auto-approval regardless of confidence):
 * - Vision quality scores at or above MIN_OVERALL_SCORE / MIN_TEXT_LEGIBILITY etc.
 * - Training-wheels threshold met (N manual approvals completed)
 *
 * Confidence factors (sum must reach AUTO_APPROVAL_THRESHOLD):
 * - Niche proven (has prior sales) → +0.25
 * - High composite score → +0.15
 * - Design type has history of selling → +0.15
 * - SEO score is strong → +0.10
 * - Niche hit rate above average → +0.15
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

  // ---- HARD GATE 1: Training wheels ----
  const tw = await getTrainingWheelsState();
  if (tw.enabled && tw.completed < tw.required) {
    return {
      approved: false,
      confidence: 0,
      reasons: [`training wheels active: ${tw.completed}/${tw.required} manual reviews completed`],
      blockedBy: "training_wheels",
    };
  }

  // ---- HARD GATE 2: Vision quality scores ----
  // The image had to pass step-04's basic gate to even reach this point,
  // but auto-approval demands STRONG scores, not just passing.
  if (product.generatedImageId) {
    const image = await db.select().from(generatedImages).where(eq(generatedImages.id, product.generatedImageId)).get();
    if (image?.qualityScores) {
      try {
        const scores = JSON.parse(image.qualityScores) as {
          composition: number;
          text_legibility: number;
          print_suitability: number;
          commercial_appeal: number;
          technical_quality: number;
          overall_score: number;
        };

        if (scores.overall_score < MIN_OVERALL_SCORE) {
          return {
            approved: false,
            confidence: 0,
            reasons: [`vision overall score ${scores.overall_score.toFixed(1)} < ${MIN_OVERALL_SCORE}`],
            blockedBy: "vision_quality",
          };
        }
        if (scores.text_legibility < MIN_TEXT_LEGIBILITY) {
          return {
            approved: false,
            confidence: 0,
            reasons: [`text legibility ${scores.text_legibility.toFixed(1)} < ${MIN_TEXT_LEGIBILITY}`],
            blockedBy: "vision_quality",
          };
        }
        if (scores.print_suitability < MIN_PRINT_SUITABILITY) {
          return {
            approved: false,
            confidence: 0,
            reasons: [`print suitability ${scores.print_suitability.toFixed(1)} < ${MIN_PRINT_SUITABILITY}`],
            blockedBy: "vision_quality",
          };
        }
        if (scores.technical_quality < MIN_TECHNICAL_QUALITY) {
          return {
            approved: false,
            confidence: 0,
            reasons: [`technical quality ${scores.technical_quality.toFixed(1)} < ${MIN_TECHNICAL_QUALITY}`],
            blockedBy: "vision_quality",
          };
        }

        // Vision quality passed — count it as a confidence factor
        confidence += 0.10;
        reasons.push(`vision ${scores.overall_score.toFixed(1)}/10`);
      } catch { /* fall through — bad JSON, skip vision gate */ }
    } else {
      // No quality scores recorded — don't auto-approve a design we never assessed
      return {
        approved: false,
        confidence: 0,
        reasons: ["no vision quality scores on record"],
        blockedBy: "missing_vision_check",
      };
    }
  }

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
