# NeoPOD Core Pipeline Skill

## Pipeline Steps

Each step is a module in `src/lib/pipeline/steps/` implementing `PipelineStep`:

```typescript
interface PipelineStep {
  name: string;
  execute(runId: string, context: PipelineContext): Promise<PipelineContext>;
}
```

### Step 1: Research (`step-01-research.ts`)
- Calls `getAllTrends()` from PodCS, FlyingResearch, Etsy
- Deduplicates by normalized niche name
- Inserts new niches (idempotent by unique name)
- Output: `discoveredNicheIds`

### Step 2: Scoring (`step-02-scoring.ts`)
- GPT-4.1 scores each niche on 5 metrics (0-10 scale)
- Weights: search_volume(0.30), competition(0.25), sales_velocity(0.25), seasonality(0.10), trending(0.10)
- Threshold: 7.5 composite score
- Output: `approvedNicheIds`

### Step 3: Concepts (`step-03-concepts.ts`)
- GPT-4.1 generates 5 design concepts per approved niche
- Each concept has: title, description, stylePrompt, designType
- **Moderation gate**: `fullModeration()` runs BEFORE saving — rejects flagged content early
- Output: `conceptIds`

### Step 4: Image Generation (`step-04-imagegen.ts`)
- DALL-E 3 HD (1024x1024) for each concept
- **Immediately persists to Vercel Blob** (DALL-E URLs expire in ~1 hour)
- 12-second delay between images (rate limit: 5/min)
- Up to 3 attempts per image
- Output: `generatedImageIds`

### Step 5: Validation (`step-05-validate.ts`)
- Downloads from Blob, post-processes with sharp (reduce AI artifacts)
- Upscales to 4500x5400 at 300 DPI
- Validates: dimensions, DPI, format (PNG), color mode (sRGB), file size (<50MB)
- Re-uploads upscaled version
- Output: `validatedImageIds`

### Step 6: Printify Products (`step-06-printify.ts`)
- Uploads design image to Printify
- Creates 3 product types per image: premium t-shirt, hoodie, blanket
- Idempotent: checks for existing products before creating
- Output: `createdProductIds`

### Step 7: Mockups (`step-07-mockups.ts`)
- Fetches 7-10 mockups per product from Printify (polling for completion)
- Persists mockup images to Vercel Blob
- Output: mockup records in DB

### Step 8: Listings (`step-08-listing.ts`)
- GPT-4.1 generates SEO-optimized title (≤140 chars), description, tags (≤13)
- **Second moderation gate**: `fullModeration()` on listing text
- Creates Etsy draft listing, uploads mockup images
- Idempotent: checks for existing listing before creating
- Output: `draftListingIds`

### Step 9: Approval (`step-09-approval.ts`)
- Groups pending listings into batches of 5
- Creates approval queue entries
- **Pauses pipeline** — requires human review in dashboard
- Output: `shouldPause: true`

### Step 10: Publish (`step-10-publish.ts`)
- Publishes approved listings on both Etsy and Printify
- Respects daily listing limit (5/day)
- Records cost and increments listing count
- Works as pipeline step AND standalone (triggered by approval API)
- Output: `approvedListingIds`

## Pipeline Engine

- `src/lib/pipeline/engine.ts` — Orchestrates steps 1-10 sequentially
- `src/lib/pipeline/context.ts` — Accumulates IDs between steps
- `src/lib/pipeline/registry.ts` — Lazy-loads step modules
- `src/lib/pipeline/concurrency.ts` — DB-level lock with 30-min auto-expiry

## Key Patterns

- Budget is checked before each step via `enforcebudget()`
- State is persisted to DB after each step (serverless-safe)
- Pipeline can resume from any step via `startFromStep`
- Step 9 pauses; step 10 resumes when approvals come in
