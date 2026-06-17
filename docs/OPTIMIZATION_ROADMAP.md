# Optimization Roadmap

> DO NOT implement until the pipeline is running end-to-end successfully.
> First milestone: Get first 10 listings live on Etsy.

## Blockers to Fix First

- [ ] Add credit card to Replicate (`https://replicate.com/account/billing`)
- [ ] Run pipeline successfully end-to-end (all 10 steps)
- [ ] Get first listings published to Etsy
- [ ] Fix niche selection — too many niches stuck below threshold, seed dedup
      clogging repeat runs, AI expansion producing generic results. Consider:
      - Adding paid trend API (PodCS or FlyingResearch) for real demand data
      - Manual niche curation for the first 50 listings
      - Narrowing to 3-5 proven niches instead of 12+ speculative ones

## Phase 1 — Revenue Lift (implement after first sales)

### Competitor-Aware Pricing (Step 6)
- Query Etsy search API at publish time for top-10 competitor prices
- Price 10-15% below average (defensible sweet spot)
- Currently pricing is blind — this alone could 2-3x conversion
- Cost: Free (uses existing Etsy API credentials)

### Post-Publish Repricing (Step 10)
- Monitor impressions/favorites after 2 weeks live
- Auto-lower price by 5-10% if <5 impressions/week
- Refresh title if CTR is below niche average
- Cost: Free (Etsy stats API)

## Phase 2 — Quality Upgrade (implement after 50+ listings)

### Higgsfield MCP Integration (Step 4)
- Add Higgsfield MCP server: `claude mcp add --transport http higgsfield https://mcp.higgsfield.ai/mcp`
- 4K native output (4096x4096) vs current 1024x1024
- Route by product type: Soul for fabric, Flux 2 for illustrations, GPT Image 2 for photorealism
- Built-in transparent PNG output for apparel
- Cost: $39/mo (Plus plan, ~500 images)

### Lifestyle Mockups (Step 7)
- Replace generic product shots with lifestyle scenes
- Gift-wrapped, in-use, seasonal context mockups convert 2-3x better
- Use Placeit's lifestyle template API or Higgsfield's Mockup Studio
- Cost: Placeit subscription or Higgsfield credits

### Image Upscaling (Step 4/5)
- Add Real-ESRGAN upscaling before quality scoring
- Evaluate print-ready output, not raw 1024px
- Critical for poster/canvas products
- Cost: ~$0.01/image via Replicate

## Phase 3 — Conversion Optimization (implement after 100+ listings)

### Long-Tail SEO (Step 8)
- Query Google autocomplete / "people also ask" for the niche
- Embed natural follow-up questions into listing descriptions
- Target featured snippet eligibility for Google Shopping traffic
- Cost: Free (web scraping or SerpAPI ~$50/mo)

### Niche Scoring on Conversion Rate (Step 2)
- Use Etsy favorites-to-sales ratio instead of raw search volume
- Filter niches that CONVERT, not just get views
- Many high-volume niches have terrible CTR
- Cost: Free (existing Etsy API)

### A/B Title Variants (Step 3)
- Generate 3-5 title variations per design (minimalist vs. emotional vs. benefit-led)
- Publish with variant A, rotate to B after 2 weeks if CTR is low
- Cost: ~$0.01 extra AI per concept

### Listing Quality Floor (Step 9)
- Reject auto-approval if description < 200 words
- Reject if SEO score < 60
- Reject if no seasonal hook during peak season
- Cost: Free (logic only)

### Fabric Color-Shift Validation (Step 5)
- Simulate how colors shift on actual garment fabric
- Catch neon/pastel designs that look great on screen but muddy on cotton
- Cost: Custom model or Printful's design validator API

## Notes

- Higgsfield pricing: Free=150 credits, Starter=$15/200cr, Plus=$39/1000cr, Ultra=$99/3000cr
- Current image cost: Flux=$0.06/image, DALL-E=$0.08/image
- Higgsfield cost: ~$0.08-0.15/image depending on model
- All phases assume the base pipeline is profitable before investing in upgrades
