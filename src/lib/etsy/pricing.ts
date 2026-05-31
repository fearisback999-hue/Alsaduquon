import { estimateEtsyFees } from "@/lib/pricing/engine";

/**
 * Calculate retail price from base cost and desired margin.
 * Formula: retailPrice = baseCost / (1 - margin/100)
 * Example: $15 cost / (1 - 0.40) = $25 retail
 */
export function calculateRetailPrice(
  baseCost: number,
  marginPercent: number = 40,
  minimumPrice: number = 25,
): number {
  const calculated = baseCost / (1 - marginPercent / 100);
  const price = Math.max(calculated, minimumPrice);
  return Math.round(price * 100) / 100; // Round to 2 decimal places
}

/**
 * Estimate profit after the full Etsy fee stack (transaction + payment
 * processing + blended offsite ads + listing fee). This feeds both the
 * dashboard and the niche-learning loop, so undercounting fees here would
 * crown false "winners" — it must match the pricing engine's fee model.
 */
export function estimateProfit(
  retailPrice: number,
  baseCost: number,
  quantity: number = 1,
): {
  revenue: number;
  etsyFees: number;
  printifyCost: number;
  profit: number;
  profitMargin: number;
} {
  const revenue = retailPrice * quantity;
  const etsyFees = estimateEtsyFees(revenue); // flat fee applied once on the order, variable on revenue
  const printifyCost = baseCost * quantity;
  const profit = revenue - etsyFees - printifyCost;
  const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

  return {
    revenue: Math.round(revenue * 100) / 100,
    etsyFees: Math.round(etsyFees * 100) / 100,
    printifyCost: Math.round(printifyCost * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    profitMargin: Math.round(profitMargin * 10) / 10,
  };
}
