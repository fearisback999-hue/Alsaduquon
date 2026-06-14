import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getTypicalShipping } from "@/lib/pricing/engine";

/**
 * Whether merchant-paid shipping is folded into price & cost (the free-shipping
 * model, where the buyer pays $0 shipping and the item price must cover it).
 * Controlled by the `shipping_in_price` setting; defaults to true.
 *
 * When false, a buyer-pays-shipping model is assumed: shipping is revenue-
 * neutral, so it's omitted from BOTH pricing and stored cost to keep the two
 * consistent (otherwise the learning loop would see phantom losses).
 */
export async function isShippingIncludedInCost(): Promise<boolean> {
  const s = await db.select().from(settings).where(eq(settings.key, "shipping_in_price")).get();
  return s ? s.value !== "false" : true;
}

/**
 * Resolves the per-item shipping cost to charge against margin for a product,
 * honoring the current shipping model. Returns 0 under a buyer-pays model.
 */
export async function resolveShippingCost(productType: string): Promise<number> {
  return (await isShippingIncludedInCost()) ? getTypicalShipping(productType) : 0;
}
