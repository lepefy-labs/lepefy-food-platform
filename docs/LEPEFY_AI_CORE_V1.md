# Lepefy AI Core V1.2 + Response Memory V1

Foundation: `100_lepefy_ai_core.sql`, already applied and verified in production by the repository owner. `102_nala_response_memory.sql` is the additive Response Memory extension and must be applied before learned-response reuse becomes active.

## Persistent operation

Registry and server-side conversation persistence are required. Missing schema/RPC, unavailable database, disabled policy and empty routing chain fail closed with normalized errors. There is no temporary Gemini bootstrap or stateless conversation fallback. Context IDs are non-null after a successful open. Conversation load/write failures stop the request; browser history and provider threads are never canonical.

## Generic retention maintenance

`POST /api/internal/ai-core-maintenance` invokes the existing service-role-only `purge_expired_ai_context` RPC. The same route also purges expired Response Memory through `purge_expired_nala_response_memory` when migration 102 is available. Response-memory cleanup is auxiliary and never blocks canonical conversation retention. No second scheduler is introduced.

It uses the same service-role bearer authentication pattern as other internal jobs. `.github/workflows/ai-core-maintenance.yml` runs hourly at minute 17 UTC and supports `workflow_dispatch`.

Configure an HTTPS application root through repository variable `AI_CORE_APP_URL`, falling back to `NALA_ENRICHMENT_APP_URL` then `EVENT_REPORTS_APP_URL`. The script rejects redirects and exits nonzero on request failure or malformed core-retention results. Nala semantic enrichment does not own AI Core retention.

## Contracts and routing

Provider adapters are under `src/lib/ai/core/providers`. Consumers call `runAi` and supply a structured schema and runtime validator. Lower numeric priority runs first; ties use model key. Only enabled provider/model/policy entries with chat and structured-output capabilities run. OpenAI-compatible endpoints use server fetch, exact HTTPS origin allowlisting and local structured-output validation.

`assertAiRouteReady(consumer, capability)` is the batch-consumer preflight. It verifies that the policy resolves to at least one enabled model/provider with a supported adapter and available configured server credential. Batch consumers use it before claiming retry-limited work, so missing routing configuration does not consume business retry counters.

Credentials are environment-variable references ending in `_API_KEY`. Raw keys cannot be edited in admin. OpenAI, Anthropic and Lepefy dedicated adapters remain deferred; their provider types are modeled but do not yet have canonical adapters.

Each attempted generation logs normalized provider/model, status, tokens when available, latency and fallback data through `logAiUsage`. Confidence fallback applies only to meaningful adapter confidence, not generated self-evaluation. Provider health is observational and never an independent eligibility filter.

Routing cache: 30 seconds per runtime. Circuit breaker: best-effort, five consecutive failures pause a model for five minutes, not shared across serverless instances.

## Nala Response Memory V1

The chat cascade is now:

```text
small talk
-> Fast Store Resolver
-> Fast Product Availability Resolver
-> Lepefy Response Memory
-> embedding retrieval
-> AI Core routed inference
```

A Response Memory hit occurs **before embeddings**, product semantic retrieval, knowledge semantic retrieval and `runAi`. It therefore avoids both the external chat provider and the external embedding request for that turn.

After a successful routed external answer, Lepefy may persist a bounded tenant-scoped operational memory only when the turn is safe to reuse. V1 allows `product_information`, `meal_preparation`, `delivery` and `store_information` with `commerceMode=none`, no pending action, no Cart Builder payload, no payment/order/support intent, no recognizable personal/contact/order identifiers, no dynamic money value and no explicitly uncertain answer. Context-dependent follow-ups whose resolved subject is not present in the current message are not learned.

Matching is local and conservative: multilingual lexical normalization maps stable question families such as definition, recipe, storage, use and delivery, then uses tenant/locale/family, bounded terms, subject presence and ambiguity thresholds. It does not call an embedding or a model to decide whether memory matches.

`nala_response_memory` is not authoritative tenant knowledge. Each row stores the validated reply + structured decision, source provider/model, 30-day expiry, hit counters and context versions. The response is reusable only while:

- `tenants.updated_at` is unchanged;
- the tenant knowledge revision is unchanged;
- every referenced product still has the same `products.updated_at`;
- every referenced knowledge row is still active with the same `tenant_knowledge_base.updated_at`.

Migration 102 adds `tenant_knowledge_base.updated_at` and its update trigger only to support deterministic invalidation; existing knowledge content is unchanged. A stale memory row is deactivated and the request falls through to normal retrieval/routing, allowing Lepefy to learn a fresh answer.

Memory hits are logged with `provider=lepefy`, `model=response_memory_v1`, `ai_call_triggered=false` and inline semantic enrichment, so the asynchronous classification worker is also skipped. When the reused answer is not backed by approved knowledge, `knowledge_status=missing` remains visible to the existing Knowledge Suggestions flow. This keeps the distinction explicit: Response Memory reduces repeated inference immediately, while tenant approval promotes durable authoritative knowledge.

Schema/RPC absence is fail-open for chat: before migration 102 is applied, lookup/persistence quietly fall through to the existing AI path instead of breaking Nala.

## Nala Semantic Enrichment through AI Core

The asynchronous worker in `src/lib/ai/nalaSemanticEnrichment.ts` no longer imports `@google/genai`, reads `GEMINI_API_KEY` directly or hardcodes `gemini-2.5-flash-lite`.

Its canonical AI route is:

```text
consumer: nala_semantic_enrichment
capability: classification
```

The worker preserves the migration-097 taxonomy, prompt minimization, tenant-scoped product/knowledge context, batch size, concurrency, three-attempt interaction retry budget and deterministic small-talk result. The semantic contract version remains `v1`; provider/model identity is recorded separately by AI Core telemetry.

Before `claim_nala_interactions_for_enrichment` runs, the worker calls `assertAiRouteReady`. If the policy, model, adapter or credential is unavailable, the internal endpoint returns HTTP 503 and **no interaction is claimed**, preventing infrastructure configuration errors from exhausting `semantic_enrichment_attempts`.

For claimed non-small-talk rows, `runAi` owns provider selection, timeout, circuit breaker, fallback and telemetry. The model output is checked by a strict semantic validator. Invalid taxonomy, invalid confidence or malformed structured output throws, allowing AI Core to try the next configured model instead of silently normalizing bad model output into analytics data.

The internal route remains service-role-only. Its logs expose only low-cardinality operational codes such as `ai_route_unavailable`, `provider_error`, `context_load_error` and `update_error`; raw provider payloads and secrets are not logged.

### Required routing configuration

Create/enable this policy in `/admin/platform/ai-routing` before rerunning the enrichment workflow:

```text
consumer: nala_semantic_enrichment
capability: classification
enabled: true
```

Add at least one enabled model that supports the structured classification contract. Provider/model order remains an admin configuration operation, not an application deploy.

## Context and privacy

UUID v4 generated server-side is an opaque conversation bearer ID. APIs never expose another tenant's conversation; UUID secrecy is required. New conversations cannot use caller-selected IDs. Leases serialize requests, with 90-second crash recovery. Successful user/assistant turns and working memory are committed atomically.

The inactivity TTL is two hours. Bounded package includes core/tenant/retrieval instructions, working memory, nullable summary, last 10 messages under 8,000 characters, current message. Rolling AI summary is deferred. The dedicated hourly AI Core maintenance job removes expired state and raw turns older than 90 days.

Response Memory is tenant-scoped operational memory, not customer memory: it stores no customer/session/geography/device identifiers and has a 30-day TTL. Its query signature is normalized/bounded and only eligible non-sensitive turns can be persisted. Approved knowledge remains a distinct human-reviewed authority layer.

Nala Semantic Enrichment is an asynchronous analytics consumer and does not use conversation memory. It receives only the current stored interaction plus the already-associated tenant-safe product/knowledge context required by migration 097.

## Hugging Face: prepared configuration

The generic `openai_compatible` adapter supports Hugging Face Inference Providers without a dedicated adapter.

Production prerequisites:

1. `HUGGINGFACE_API_KEY` configured server-side in Vercel.
2. `https://router.huggingface.co` present in `LEPEFY_AI_ALLOWED_ORIGINS`.
3. Provider base URL `https://router.huggingface.co/v1` configured in `/admin/platform/ai-routing`.
4. Compatible model configured with the required capabilities.
5. Model added to the desired policy chain.

Do not store the token in source, database registry values, admin config JSON or logs. Availability, account access, latency and structured-output quality require live verification; CI performs no live paid/provider AI calls.

## Semantic acceptance

Automated mocked-adapter tests prove routing and structured contracts, not live semantic accuracy. For conversational Nala continue validating contextual sequences and verify that safe repeated informational questions transition from an initial external provider call to `provider=lepefy / model=response_memory_v1` on a sufficiently similar later request when authoritative context is unchanged.

For semantic enrichment, verify after policy activation that a manual workflow run moves pending/retry rows to `completed`, that AI usage telemetry contains `consumer=nala_semantic_enrichment` and `capability=classification`, and that provider/model values match the configured chain.

## Remaining direct-provider-call debt

Direct provider calls still to migrate when justified:

- `apps/storefront/src/lib/ai/embeddings.ts` (shared retrieval and indexing; Response Memory bypasses it on hits but misses still use it);
- `apps/storefront/src/app/api/admin/generate-product-description/route.ts`;
- `apps/storefront/src/app/api/admin/generate-product-image/route.ts`;
- `scripts/generate-product-descriptions.mjs`;
- `scripts/generate-product-images.mjs`;
- `scripts/generate-product-embeddings.mjs`.

`nalaSemanticEnrichment.ts` is no longer part of this debt list.

## Validation

CI runs typecheck, unit tests, `git diff --check`, AI Core SQL isolation, Response Memory migration/isolation and Platform Prospects migration/isolation. Vercel validates the production build. Live provider calls remain out of automated CI. Existing lint may still fail on the pre-existing interactive ESLint configuration; report its actual result separately rather than treating it as a Response Memory regression.
