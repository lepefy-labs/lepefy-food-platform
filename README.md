# Lepefy Food — SaaS Platform

Multi-tenant food e-commerce SaaS for African food shops in Europe.

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp apps/storefront/.env.local.example apps/storefront/.env.local
# Edit with your Supabase credentials and TENANT_SLUG

# 3. Run database migrations (requires Supabase CLI)
supabase start
supabase db push
supabase db seed --db-url postgresql://postgres:postgres@localhost:54321/postgres < supabase/seed.sql

# 4. Start dev server
pnpm dev
```

## Architecture

- **apps/storefront** — Next.js 14 App Router storefront
- **packages/types** — Shared TypeScript interfaces
- **supabase/migrations** — PostgreSQL schema + RLS policies
- **supabase/seed.sql** — ChloeFood tenant seed data

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TENANT_SLUG` | Tenant identifier (e.g. `chloefood`) |
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
