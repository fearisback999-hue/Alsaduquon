# NeoPOD Safety & Cost Rules

## Cost Guardrails

### Daily Limits
- **Max daily spend**: $10.00 (configurable via settings)
- **Max daily listings**: 5 (configurable via settings)
- Budget is checked from DB before every pipeline step (no in-memory cache — serverless safe)

### Cost Tracking
- `dailyCosts` table: date-keyed daily totals
- `costEntries` table: line-item records by category (ai_text, ai_image, api_call)
- `tokenUsages` table: per-model, per-operation token counts
- All costs recorded via `recordCost()` after each billable operation

### Cost Constants
- DALL-E 3 HD: $0.080 per image
- GPT-4.1 input: $0.002 per 1K tokens
- GPT-4.1 output: $0.008 per 1K tokens
- Etsy listing fee: $0.20 per listing
- Etsy transaction fee: 6.5% of sale price
- Etsy payment processing: 3% + $0.25

### Budget Enforcement
- `checkBudget()` — returns whether budget is available
- `canAfford(amount)` — checks specific amount
- `enforcebudget()` — throws `BudgetExceededError` if over limit
- `checkListingLimit()` / `enforceListingLimit()` — listing count checks

## Security Rules

### Authentication
- Dashboard protected by httpOnly session cookie
- Cookie set on successful password login (`ADMIN_PASSWORD` env var)
- Cron routes validate `CRON_SECRET` header
- `/api/health` is the only public endpoint

### Secret Management
- All secrets in environment variables, validated by Zod on startup
- `.env.example` documents required vars without values
- Logger redacts secrets matching patterns: API keys, tokens, Bearer headers
- `.gitignore` excludes `.env*` (except `.env.example`)

### Content Moderation
- **Two gates**: Step 3 (before image gen) and Step 8 (before listing)
- OpenAI Moderation API for hate/violence/self-harm/sexual content
- Custom Etsy policy check for banned trademark terms
- Flagged content is rejected, not generated/published

### Input Validation
- Zod schemas for all external input
- SQL injection prevented by Drizzle ORM parameterized queries
- No user-supplied content in raw SQL

### Rate Limiting
- Per-service token bucket rate limiter
- DALL-E: 5 requests/minute
- Etsy: 10 requests/second
- Printify: 5 requests/second
- 12-second delay between DALL-E image generations

## Pipeline Safety

### Idempotency
- All external create operations check for existing records first
- Niches deduplicated by unique name
- Products checked by conceptId before Printify create
- Listings checked by productId before Etsy create

### Concurrency Control
- DB-level pipeline lock (`pipelineRuns` status field)
- Only one pipeline run active at a time
- Stale locks auto-expire after 30 minutes

### Resumability
- Pipeline state persisted to DB after each step
- Can resume from any step via `startFromStep`
- Step 9 pauses for human approval; step 10 resumes

### Error Handling
- Custom error classes with context (step, operation, retryable flag)
- `withRetry()` for transient external API failures
- Pipeline records error in `pipelineRuns` and `pipelineStepLogs`
- Failed steps don't lose previously completed work
