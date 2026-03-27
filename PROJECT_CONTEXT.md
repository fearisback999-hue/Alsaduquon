# NeoPOD — Automated Etsy Print-on-Demand System

## Vision

Fully automated pipeline that discovers trending niches, generates print-ready designs via AI, creates products on Printify, lists them on Etsy, and tracks orders/revenue — targeting $150K/year with 500+ live listings.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14+ (App Router, TypeScript strict) |
| Database | Turso (libSQL) via Drizzle ORM |
| Image Storage | Vercel Blob |
| AI — Text | OpenAI GPT-4.1 |
| AI — Images | OpenAI DALL-E 3 (HD) |
| Print Provider | Printify API |
| Marketplace | Etsy API v3 (OAuth 2.0) |
| Trend Data | PodCS, FlyingResearch, Etsy search |
| Hosting | Vercel (serverless) |
| CSS | Tailwind CSS |

## Architecture

### 10-Step Pipeline

1. **Research** — Pull trending niches from external APIs
2. **Scoring** — GPT-4.1 scores each niche (weighted composite, threshold 7.5)
3. **Concepts** — Generate 5 design concepts per niche, moderation gate
4. **Image Gen** — DALL-E 3 HD, persist immediately to Vercel Blob
5. **Validation** — Upscale to 4500x5400, validate DPI/format/size
6. **Printify** — Upload designs, create 3 product types per image
7. **Mockups** — Fetch mockups from Printify, persist to Blob
8. **Listings** — Generate SEO title/tags/description, create Etsy drafts, second moderation gate
9. **Approval** — Batch into groups of 5, pause pipeline for human review
10. **Publish** — Publish approved listings, respect daily limits

### Key Constraints

- **Vercel serverless**: No persistent memory, no long-running processes. Pipeline state lives in DB.
- **DALL-E rate limits**: 5 images/minute max. 12-second delays between generations.
- **Etsy OAuth 2.0**: Tokens auto-refresh. No OAuth 1.0.
- **Cost guardrails**: $10/day max spend, 5 listings/day max. Budget checked before each step.
- **Idempotency**: All external API creates check for existing records first.
- **Pipeline lock**: DB-level lock with 30-minute auto-expiry for stale runs.

### Database

15+ tables defined in `src/lib/db/schema.ts` using Drizzle ORM with SQLite-compatible types. Key tables: `pipelineRuns`, `pipelineStepLogs`, `niches`, `designConcepts`, `generatedImages`, `printifyProducts`, `etsyListings`, `approvalQueueEntries`, `orders`, `dailyCosts`, `costEntries`, `tokenUsages`.

### Cron Schedule (Vercel)

- Pipeline: daily at 6:00 UTC
- Order sync: every 4 hours
- Analytics: daily at 2:00 UTC

## Environment Variables

See `.env.example` for all required variables. Key ones:
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — Database
- `OPENAI_API_KEY` — AI generation
- `PRINTIFY_API_TOKEN` / `PRINTIFY_SHOP_ID` — Print provider
- `ETSY_CLIENT_ID` / `ETSY_CLIENT_SECRET` / `ETSY_REFRESH_TOKEN` / `ETSY_SHOP_ID` — Marketplace
- `BLOB_READ_WRITE_TOKEN` — Image storage
- `ADMIN_PASSWORD` / `CRON_SECRET` — Auth
