import { db } from "@/lib/db";
import { customerReviews, listings } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import * as etsy from "@/lib/external/etsy";
import { log } from "@/lib/logger";

// Keyword patterns for quality issue detection on low-rated reviews
const ISSUE_PATTERNS: Array<{ keywords: string[]; issueType: string }> = [
  { keywords: ["blurry", "faded", "cracked", "peeling"], issueType: "print_quality" },
  { keywords: ["too small", "too big", "doesn't fit", "sizing"], issueType: "sizing" },
  { keywords: ["wrong color", "different color"], issueType: "color_mismatch" },
  { keywords: ["damaged", "broken", "torn"], issueType: "shipping_damage" },
];

function detectQualityIssue(reviewText: string): string | null {
  const lower = reviewText.toLowerCase();
  for (const pattern of ISSUE_PATTERNS) {
    for (const keyword of pattern.keywords) {
      if (lower.includes(keyword)) {
        return pattern.issueType;
      }
    }
  }
  return null;
}

function classifySentiment(rating: number, hasQualityIssue: boolean): "positive" | "neutral" | "negative" | "flagged" {
  if (hasQualityIssue) return "flagged";
  if (rating >= 4) return "positive";
  if (rating === 3) return "neutral";
  return "negative";
}

export async function syncCustomerReviews(): Promise<{ synced: number; flagged: number }> {
  let synced = 0;
  let flagged = 0;
  let offset = 0;
  const limit = 25;
  let hasMore = true;

  try {
    while (hasMore) {
      const response = await etsy.getShopReviews(limit, offset);
      const reviews = response.results ?? [];

      for (const review of reviews) {
        try {
          // Skip if we already synced this review
          const existing = await db
            .select()
            .from(customerReviews)
            .where(eq(customerReviews.externalReviewId, String(review.review_id)))
            .get();

          if (existing) continue;

          // Find our internal listing by Etsy listing ID
          const internalListing = await db
            .select()
            .from(listings)
            .where(
              and(
                eq(listings.externalListingId, String(review.listing_id)),
                eq(listings.platform, "etsy"),
              ),
            )
            .get();

          // Analyze for quality issues on low-rated reviews
          const reviewText = review.review ?? "";
          let issueType: string | null = null;
          let qualityIssue = false;

          if (review.rating <= 2 && reviewText.length > 0) {
            issueType = detectQualityIssue(reviewText);
            qualityIssue = issueType !== null;
          }

          const sentiment = classifySentiment(review.rating, qualityIssue);

          await db.insert(customerReviews).values({
            listingId: internalListing?.id ?? null,
            platform: "etsy",
            externalReviewId: String(review.review_id),
            rating: review.rating,
            reviewText: reviewText || null,
            sentiment,
            qualityIssue,
            issueType,
          });

          synced++;
          if (qualityIssue) flagged++;
        } catch (error) {
          log("error", `Failed to sync review ${review.review_id}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      offset += limit;
      hasMore = reviews.length === limit;
    }
  } catch (error) {
    log("error", "Customer review sync failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  log("info", `Customer review sync: ${synced} synced, ${flagged} flagged`);
  return { synced, flagged };
}
