# Multi-Platform Setup Guide

Selling the same designs on more than one marketplace is the biggest revenue
multiplier available to this system: the pipeline already generates
platform-specific titles, tags, and descriptions for every listing, and every
platform strategy is implemented. Turning a platform on is a two-step config
change — **set its credentials**, then **enable it** — no code required.

> Check current status any time at **`GET /api/platforms/status`** (authenticated)
> or in the optimize cron logs. It reports which platforms have credentials and
> which are enabled.

## Prerequisites (required for every platform)

Product creation runs through Printify, so these must be set regardless of which
channels you sell on:

```
PRINTIFY_API_TOKEN=...
PRINTIFY_SHOP_ID=...
```

## Step 1 — Add credentials

Add the env vars for each platform you want to `.env.local` (local) and to your
Vercel project settings (production). After editing env vars, restart `npm run
dev` or redeploy.

| Platform | Required env vars | Order sync | Notes |
|---|---|---|---|
| **Etsy** | `ETSY_CLIENT_ID`, `ETSY_CLIENT_SECRET`, `ETSY_REFRESH_TOKEN`, `ETSY_SHOP_ID` | ✅ | Primary channel. Full publish + order + metrics sync. |
| **Shopify** | `SHOPIFY_STORE_URL`, `SHOPIFY_ACCESS_TOKEN` | ✅ | Free listings (no per-listing fee). View metrics unavailable on Basic plan. |
| **TikTok Shop** | `TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET`, `TIKTOK_SHOP_ACCESS_TOKEN` | ❌ | Publishing works; order/metrics sync not yet implemented. |
| **Amazon** | `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`, `AMAZON_REFRESH_TOKEN`, `AMAZON_SELLER_ID` | ❌ | $0.99 per-listing fee. Order/metrics sync not yet implemented. |
| **Depop** | `DEPOP_ACCESS_TOKEN` | ❌ | Cannot update titles after publish. |
| **Redbubble** | `REDBUBBLE_API_KEY`, `REDBUBBLE_ACCOUNT_ID` | ❌ | Price/title immutable after publish. |

## Step 2 — Enable the platform

Set the `enabled_platforms` setting to a JSON array of the platform ids you want
the pipeline to publish to. Via the API:

```bash
curl -X PUT https://<your-app>/api/settings \
  -H 'Content-Type: application/json' \
  --cookie 'neo-pod-auth=<your session cookie>' \
  -d '{"key":"enabled_platforms","value":"[\"etsy\",\"shopify\"]"}'
```

Valid ids: `etsy`, `shopify`, `tiktok`, `depop`, `redbubble`, `amazon`.

Once enabled, the next pipeline run creates a listing per product **per enabled
platform**, each with channel-tailored SEO copy.

## Recommended rollout

1. **Etsy first.** Establish standing before adding channels (see the
   shop-age listing-limit advisor — it keeps you under Etsy's new-shop throttle).
2. **Add Shopify next.** It's free to list and has working order sync, so your
   profitability numbers stay complete.
3. **Then TikTok Shop / Amazon** for reach, accepting that order-level profit
   won't sync automatically yet (revenue still tracked at the platform).

## Cost note

Each enabled platform multiplies image-generation and listing volume, so raise
`max_daily_cost` accordingly. As a rough guide, budget ~$0.10 of AI cost per
design plus each platform's listing fee (Etsy $0.20, Amazon $0.99, others $0).
