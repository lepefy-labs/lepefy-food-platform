# Lepefy AI Core V1.1

Foundation: migration 100_lepefy_ai_core.sql, already applied and verified in production by the repository owner. V1.1 requires no new migration and does not modify migration 100.

## Persistent operation
Registry and server-side conversation persistence are required. Missing schema/RPC, unavailable database, disabled policy and empty routing chain fail closed with normalized errors. There is no temporary Gemini bootstrap or stateless conversation fallback. Context IDs are non-null after a successful open. Conversation load/write failures stop the request; browser history and provider threads are never canonical.

## Generic retention maintenance
POST /api/internal/ai-core-maintenance invokes the existing service-role-only purge_expired_ai_context RPC. It uses the same service-role bearer authentication pattern as other internal jobs, returns 401 for invalid authentication, and 503 with ai_core_maintenance_failed on RPC/transport/invalid-result failure. Successful responses contain ok: true and deletedConversations: a nonnegative integer counting deleted conversation rows, not turns or state rows. Logs and script failures exclude credentials and raw database/response details.

.github/workflows/ai-core-maintenance.yml runs hourly at minute 17 UTC and supports workflow_dispatch. It executes scripts/process-ai-core-maintenance.mjs with the existing SUPABASE_SERVICE_ROLE_KEY secret. Configure an HTTPS application root through repository variable AI_CORE_APP_URL, falling back to NALA_ENRICHMENT_APP_URL then EVENT_REPORTS_APP_URL (empty values are skipped). The script rejects redirects and exits nonzero on request failure or malformed results. Operators can manually run “AI Core maintenance” in GitHub Actions and inspect its result; successful deployment alone does not prove the job has executed. Scheduled delivery can be delayed by GitHub.

Nala semantic enrichment no longer performs AI Core retention. No duplicate SQL function or migration is introduced.

## Contracts and routing
Provider adapters are under src/lib/ai/core/providers. Consumers call runAi and supply a structured schema and runtime validator. Lower numeric priority runs first; ties use model key. Only enabled provider/model/policy entries with chat and structured_output capabilities run. The default chain contains the existing gemini-2.5-flash model. OpenAI-compatible endpoints use server fetch and must support Chat Completions JSON object mode; the requested schema is included in the system message and validated locally. Set base_url to the API root (including /v1 as needed), and allow its exact HTTPS origin in LEPEFY_AI_ALLOWED_ORIGINS. Credentials are env variable references ending in _API_KEY. Raw keys cannot be edited in admin.

OpenAI, Anthropic and Lepefy dedicated adapters are deferred. Their provider types are modeled but cannot be enabled through V1 admin. Model costs are metadata; existing ai_pricing remains the estimated-cost source. No billing changes.

Each attempted generation logs normalized provider/model, status, tokens when available, latency and fallback data through logAiUsage. Confidence fallback applies only to meaningful adapter confidence, not generated self-evaluation. All failures normalize into AiRoutingError. Business validation runs afterwards and never retries another model.

Routing cache: 30 seconds per runtime. Circuit breaker: best-effort, five consecutive failures pause a model for five minutes, not shared across serverless instances. Provider health is last observed invocation health, not distributed monitoring or an eligibility filter. A degraded provider remains eligible when enabled; the runtime circuit breaker is separate.

## Context and privacy
UUID v4 generated server-side is an opaque conversation bearer ID. APIs never expose another tenant's conversation; UUID secrecy is required. New conversations cannot use caller-selected IDs. Leases serialize requests, with 90-second crash recovery. Successful user/assistant turns and working memory are committed atomically. New tab with new sessionStorage means new context; duplicated tabs may copy sessionStorage (browser behavior). Refresh restores context for the next message, not the visual transcript. No localStorage, cookies, fingerprint, IP, raw UA or long-term memory.

The inactivity TTL is two hours. Bounded package includes core/tenant/retrieval instructions, working memory, nullable summary, last 10 messages under 8,000 characters, current message. Rolling AI summary is deferred. The dedicated hourly AI Core maintenance job removes expired state and raw turns older than 90 days. Expiry prevents context reuse immediately, independently of physical cleanup timing. The operator must keep the dedicated workflow active.

## Hugging Face: prepared configuration, not activated
The existing generic openai_compatible adapter supports this configuration without a dedicated HF adapter. Hugging Face documents the [OpenAI-compatible Chat Completions endpoint and token permission](https://huggingface.co/docs/inference-providers/tasks/chat-completion), the [GPT-OSS 20B model](https://huggingface.co/openai/gpt-oss-20b), and [the :fastest routing suffix](https://huggingface.co/docs/inference-providers/en/guides/evaluation-inspect-ai). Actual provider availability, account access and structured-output quality require live verification; CI uses no live AI calls.

Before saving/activating the provider:
1. Add HUGGINGFACE_API_KEY as a server-side Vercel environment variable containing an HF token with Inference Providers permission.
2. Append the exact origin https://router.huggingface.co to the comma-separated LEPEFY_AI_ALLOWED_ORIGINS, preserving existing allowed origins, and deploy these environment settings. The admin validates origins even when saving a disabled provider.
3. In /admin/platform/ai-routing, configure the provider, model and policy below. Never paste the token into admin payloads, config JSON, registry rows or source files.

| Provider field | Value |
| --- | --- |
| key | huggingface |
| name | Hugging Face Inference Providers |
| provider_type | openai_compatible |
| credential_ref | HUGGINGFACE_API_KEY |
| base_url | https://router.huggingface.co/v1 |
| config | {} |

| Model field | Value |
| --- | --- |
| key | hf-gpt-oss-20b |
| provider_model_id | openai/gpt-oss-20b:fastest |
| display_name | GPT-OSS 20B · Hugging Face |
| capabilities | chat: true, structured_output: true, classification: true |
| config | {}; leave Gemini thinkingBudget blank |
| cost fields / context_window | Leave unknown values null; do not invent prices |

For nala / structured_chat, retain Gemini at priority 1. After configuration and manual verification, enable HF provider/model and add its routing entry at priority 2 with timeout_ms 6000 and min_confidence null. This fits the existing total 18-second budget after Gemini's 12-second timeout; remaining budget can be smaller due to elapsed work. JSON object responses still undergo runtime schema and business validation.

The allowlist requires HTTPS, exact approved origins and no URL credentials, query or fragment. Fetch uses redirect: error; redirects cannot carry credentials to another origin. No environment variable, production registry row or policy is changed by this delivery. Hugging Face is not active merely because these instructions exist.

## Semantic acceptance cases
Automated mocked-adapter tests prove routing and context contracts, not live model semantic accuracy. For live semantic acceptance, verify in the storefront:
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
CI now runs existing unit tests, git diff --check, and migration 100 against an isolated PostgreSQL 16 fixture (tenant isolation, concurrency lease, refresh, provider switch, expiry, retention and grants). Existing typecheck/lint remain. Vercel validates production build. V1.1 adds focused regression coverage for missing schema, persistent context failures, maintenance result normalization, URL allowlisting/redirect rejection and observational provider health. Production migration status is the owner’s verified prerequisite; CI does not establish it. Existing lint may fail on the legacy interactive ESLint setup; report its actual result separately.
