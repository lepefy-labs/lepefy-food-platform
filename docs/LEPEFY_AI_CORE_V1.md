# Lepefy AI Core V1

Base: e85de26419a2d5902157ea56bdfa28f8c4af222f. Migration: 100_lepefy_ai_core.sql.

## Rollout
1. Push the complete implementation once; verify CI and Vercel on that SHA.
2. Repository owner applies migration 100 manually in Supabase, in one transaction.
3. Confirm ai_providers contains Gemini and nala / structured_chat has its enabled model.
4. Open /admin/platform/ai-routing as platform owner. A tenant admin must be redirected/denied.
5. Send two messages, refresh and continue. Check ai_conversations, turns and working_memory server-side.
6. Check scheduled Nala worker successfully calls purge_expired_ai_context.
7. Remove temporary bootstrap after the schema rollout is verified.

During the manual migration window only, missing-table/RPC errors enable stateless bootstrap Gemini. Logs explicitly say MIGRATION 100 MISSING. No browser history or provider thread is canonical. Generic DB errors, disabled policy or empty chain fail closed. No migration is applied automatically to production by CI.

## Contracts and routing
Provider adapters are under src/lib/ai/core/providers. Consumers call runAi and supply a structured schema and runtime validator. Lower numeric priority runs first; ties use model key. Only enabled provider/model/policy entries with chat and structured_output capabilities run. The default chain contains the existing gemini-2.5-flash model. OpenAI-compatible endpoints use server fetch and must support Chat Completions JSON object mode; the requested schema is included in the system message and validated locally. Set base_url to the API root (including /v1 as needed), and allow its exact HTTPS origin in LEPEFY_AI_ALLOWED_ORIGINS. Credentials are env variable references ending in _API_KEY. Raw keys cannot be edited in admin.

OpenAI, Anthropic and Lepefy dedicated adapters are deferred. Their provider types are modeled but cannot be enabled through V1 admin. Model costs are metadata; existing ai_pricing remains the estimated-cost source. No billing changes.

Each attempted generation logs normalized provider/model, status, tokens when available, latency and fallback data through logAiUsage. Confidence fallback applies only to meaningful adapter confidence, not generated self-evaluation. All failures normalize into AiRoutingError. Business validation runs afterwards and never retries another model.

Routing cache: 30 seconds per runtime. Circuit breaker: best-effort, five consecutive failures pause a model for five minutes, not shared across serverless instances. Provider health is last observed invocation health, not distributed monitoring.

## Context and privacy
UUID v4 generated server-side is an opaque conversation bearer ID. APIs never expose another tenant's conversation; UUID secrecy is required. New conversations cannot use caller-selected IDs. Leases serialize requests, with 90-second crash recovery. Successful user/assistant turns and working memory are committed atomically. New tab with new sessionStorage means new context; duplicated tabs may copy sessionStorage (browser behavior). Refresh restores context for the next message, not the visual transcript. No localStorage, cookies, fingerprint, IP, raw UA or long-term memory.

The inactivity TTL is two hours. Bounded package includes core/tenant/retrieval instructions, working memory, nullable summary, last 10 messages under 8,000 characters, current message. Rolling AI summary is deferred. The existing scheduled enrichment worker invokes purge every 10 minutes; expired state is removed and raw turns older than 90 days are deleted. The operator must verify the existing workflow remains active.

## Semantic acceptance cases
Automated mocked-adapter tests prove routing and context contracts, not live model semantic accuracy. After applying the migration, verify in the storefront:
- J’ai envie de quelque chose de camerounais → Le ndolé me tente.
- Je veux cuisiner du ndolé; J’aimerais manger du ndolé; J’ai envie de ndolé; On se ferait bien un ndolé ce soir.
- Expected for dish context: meal_preparation / cart_builder.
- Avez-vous du manioc ? → product_search / product_action.
- J’ai envie de chocolat → product_search or recommendation, not forced recipe.
- Je vous prépare le panier ? → Oui: retain dish and resolve pending action.
- Switch configured model between turns: context is unchanged.
No AI decision mutates the cart. Existing canonical product/stock/tenant validation and user confirmation remain authoritative.

## Remaining direct-call debt
- apps/storefront/src/lib/ai/embeddings.ts (shared retrieval and indexing).
- apps/storefront/src/lib/ai/nalaSemanticEnrichment.ts (097 worker).
- apps/storefront/src/app/api/admin/generate-product-description/route.ts.
- apps/storefront/src/app/api/admin/generate-product-image/route.ts.
- scripts/generate-product-descriptions.mjs.
- scripts/generate-product-images.mjs.
- scripts/generate-product-embeddings.mjs.

Nala initial retrieval times out after four seconds and can degrade to no matches while routed inference proceeds. Ingredient resolution still depends on legacy embeddings and safely omits a failed proposal. No new embedding space or index migration is attempted.

## Validation
CI now runs existing unit tests, git diff --check, and migration 100 against an isolated PostgreSQL 16 fixture (tenant isolation, concurrency lease, refresh, provider switch, expiry, retention and grants). Existing typecheck/lint remain. Vercel validates production build. These checks do not prove the manual production migration has been applied.
