# CLAUDE.md — NeoPOD

## Project

Automated Etsy Print-on-Demand system. See `PROJECT_CONTEXT.md` for full architecture.

## Skills

- `skills/neo-pod-core-skill/SKILL.md` — Pipeline step definitions and engine details
- `skills/neo-pod-coding-style/SKILL.md` — TypeScript conventions and file organization
- `skills/neo-pod-safety-cost/SKILL.md` — Security, cost guardrails, and safety rules

## Quick Reference

### Commands
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run db:generate  # Generate Drizzle migrations
npm run db:migrate   # Run migrations
npm run db:seed      # Seed default settings
```

### Key Files
- `src/lib/db/schema.ts` — All database table definitions
- `src/lib/pipeline/engine.ts` — Pipeline orchestration
- `src/lib/pipeline/steps/` — Steps 01-10
- `src/lib/cost/guard.ts` — Budget enforcement
- `src/lib/ai/client.ts` — OpenAI client
- `src/lib/external/etsy.ts` — Etsy OAuth 2.0 client
- `src/lib/external/printify.ts` — Printify API client

### Architecture Rules
- Database is Turso (libSQL) via Drizzle — NOT Prisma, NOT raw SQLite
- Images must be persisted to Vercel Blob immediately (DALL-E URLs expire)
- Etsy uses OAuth 2.0 (NOT OAuth 1.0)
- Budget checked before every pipeline step
- Moderation runs at step 3 AND step 8
- All external creates are idempotent
- Pipeline pauses at step 9 for human approval
