# NeoPOD Coding Style

## TypeScript Conventions

- **Strict mode** enabled (`strict: true` in tsconfig)
- **No `any`** — use `unknown` and narrow, or define proper types
- **Zod** for runtime validation of env vars and external API responses
- **Type imports**: use `import type { ... }` when importing only types
- **Enums as unions**: prefer `"pending" | "running" | "completed"` over TypeScript enums

## File Organization

```
src/
  app/                    # Next.js App Router pages and API routes
    api/                  # API endpoints
    dashboard/            # Dashboard pages (client components)
    login/                # Login page
  lib/                    # Shared libraries
    ai/                   # OpenAI client, moderation, token tracking
    analytics/            # Analytics aggregation
    cost/                 # Budget guards and estimators
    db/                   # Drizzle schema, client, seed
    etsy/                 # SEO generation, pricing
    external/             # External API clients (Printify, Etsy, trends)
    images/               # Storage, upscaling, validation
    pipeline/             # Engine, context, registry, concurrency
      steps/              # Step 01-10 implementations
  components/ui/          # Reusable UI components
```

## Naming

- Files: `kebab-case.ts`
- Functions/variables: `camelCase`
- Types/interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE` for true constants, `camelCase` for config objects
- DB tables: `camelCase` in Drizzle, `snake_case` in SQL

## Patterns

- **Singleton clients**: OpenAI, Drizzle DB use module-level singletons with global cache for serverless
- **Error classes**: Custom errors extend `Error` with additional context (`BudgetExceededError`, `ExternalAPIError`, etc.)
- **Retry with backoff**: `withRetry()` wrapper for external API calls
- **Structured logging**: JSON logs with secret redaction via `log()` helper
- **Idempotency**: Always check for existing records before external creates

## Dashboard Pages

- Server components for data-fetching pages (overview)
- Client components (`"use client"`) for interactive pages
- Fetch from internal API routes using `fetch("/api/...")`
- Tailwind CSS for all styling, no CSS modules
- Responsive: designed for desktop-first dashboard use

## API Routes

- Next.js App Router route handlers (`route.ts`)
- Return `NextResponse.json()` with consistent shape
- Error responses include `{ error: string }` with appropriate status codes
- Auth checked via middleware (cookie for dashboard, CRON_SECRET for cron)
