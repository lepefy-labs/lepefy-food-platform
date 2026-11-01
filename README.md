# Lepefy Food — SaaS Platform

Multi-tenant food e-commerce SaaS for African food shops in Europe.

## Setup

```bash
pnpm install
cp apps/storefront/.env.local.example apps/storefront/.env.local   # valori di Supabase LOCALE
scripts/local-db-bootstrap.sh --reset                               # ricostruisce il DB locale
pnpm dev
```

La procedura completa (WSL2, Docker, Supabase CLI, primo utente admin, differenze note tra repo e produzione) è in [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md).

## Architecture

- **apps/storefront** — Next.js 14 App Router storefront
- **packages/types** — Shared TypeScript interfaces
- **supabase/migrations** — PostgreSQL schema + RLS policies
- **supabase/seed.sql** — ChloeFood tenant seed data

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_TENANT_SLUG` | Tenant identifier (e.g. `chloefood`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only) |
| `NEXT_PUBLIC_APP_URL` | Public app URL |

## Week 1 Features

- [x] Multi-tenant architecture with TenantProvider
- [x] Product catalog with SSR + category filter
- [x] Product detail page with add-to-cart
- [x] Zustand cart store (localStorage)
- [x] Shipping zone/rate calculation (pure function)
- [x] Supabase migrations + RLS policies
- [x] ChloeFood seed data (5 products, 7 categories, 4 shipping zones, 28 rates)
