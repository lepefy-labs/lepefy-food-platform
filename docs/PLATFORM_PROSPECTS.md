# Platform prospects V1

Internal route: /admin/platform/prospects, with /[id] detail. Only Platform Owner can read or write.
Implementation lives in apps/storefront/src/lib/platform/prospects. The existing Platform layout,
requirePlatformOwner guard, service client and admin styling are reused. Tenant roles/permissions
and tenant tables are unchanged.

## Database and activation

Migration 101_platform_prospects.sql is additive and must be applied to the intended Supabase project
before using discovery. It creates platform_prospects, platform_prospect_runs, platform_prospect_cache
and platform_prospect_gates, plus service-only claim/release functions. RLS is enabled, browser roles
have no grants or policies. No tenant foreign key, conversion workflow or backfill is introduced.
A missing migration produces an explicit 503 rather than showing an empty successful dashboard.

The repository migration and CI validation do not prove that production Supabase has been migrated.
Apply through the existing approved Supabase migration process, then verify owner discovery and
that tenant users receive 403. No automatic production SQL execution is added to CI.
The CI step runs 101 and its isolation tests only against ephemeral PostgreSQL.

## Discovery

The replaceable DiscoveryProvider currently uses the public API Recherche d'entreprises, derived
from SIRENE. Documentation: https://recherche-entreprises.api.gouv.fr/docs/
OpenAPI: https://recherche-entreprises.api.gouv.fr/openapi.json
Dataset: https://www.data.gouv.fr/fr/datasets/donnees-des-entreprises-utilisees-dans-lannuaire-des-entreprises/

This is a bounded business-discovery adapter, not an exhaustive SIRENE export. The upstream activity
filter applies to legal units. Every returned establishment is checked again against activity,
region, department, city and active-state filters. Up to 100 matching establishments per legal unit
are requested; very large chains are not exhaustively paginated. At most 100 upstream pages are
visited per run. Narrow geography/categories when the run reaches that ceiling.
City is an address search and a normalized city-prefix check; it is not a commune geocoder.

NAF rev. 2 food presets live in config.ts: 47.11B/C, 47.21Z, 47.22Z, 47.23Z, 47.24Z, 47.29Z, 56.21Z.
Review this mapping for the NAF transition in 2027. APE cannot prove African/Antillean specialization,
halal certification, or independence; the owner reviews those characteristics manually.
Only public business fields are retained; directors, birth dates and personal identities are excluded.

SIRET wins deduplication. Distinct SIRETs are never merged, even on a shared website.
Without two SIRETs, domain matching also requires consistent name/postcode; fallback requires name,
postcode AND address. Ambiguous businesses remain separate. Rediscovery never overwrites sales
notes, suppression or contact history.

## Batching and costs

The owner prepares a run and clicks Execute / resume. Each server request processes at most 20
discovery candidates or one enrichment. Selection is capped at 10 prospects, discovery at 500.
The browser continues sequential batches while open; closing it pauses after the current request.
Recent runs can be resumed. This is not an unattended worker or a new scheduler.
A 180-second durable lease serializes pipeline execution across serverless instances (request
maxDuration 60 seconds), while persisted cursors and SIRET uniqueness make crash replay safe.
Concurrent lease attempts return 429. Failed runs can be manually resumed; upstream Retry-After
sets a persistent cooldown. No unbounded parallel requests are issued.

Refresh windows in config.ts: website 14 days, OSM 30 days, SIRENE 90 days.
Identical recent discovery runs are reused. Provider cache stores minimized records / parsed signals,
never raw site HTML. Failed website attempts use a one-hour cache. Source rate gates are persistent:
SIRENE >=2 seconds, Overpass >=10 seconds, websites >=1 second between page requests.
Source 429/503 backoff is persisted. Expired cache entries are replaced on reuse.

## Optional OSM

Overpass is queried only when coordinates exist and website/phone information is insufficient.
Matching requires SIRET or an unambiguous exact normalized business name within 100m, with compatible
postcode. No Nominatim bulk lookup is used. A failed OSM lookup cannot fail the entire pipeline.
OSM attribution/ID and opening hours are retained. Data: OpenStreetMap contributors, ODbL.
Provider endpoint: https://overpass-api.de/api/interpreter

## Website safety and evidence

Normal Node HTTP(S) GET only, explicit Lepefy User-Agent. No proxy, browser scraping, Google Maps,
LinkedIn, CAPTCHA-solving, authentication or protection bypass.
Only HTTP/HTTPS, default web ports, no credentials. Every connection and redirect validates DNS;
all answers must be public, and the socket uses the validated IP with original TLS hostname.
Private/local, metadata, reserved, mapped and transition networks are refused.
Responses have timeout, byte, encoding and content-type limits. A website crawl has a bounded time
budget and visits at most homepage plus two same-origin relevant links; redirect hops are bounded.
Robots allow/disallow is checked per origin, including redirects. Robots errors fail closed except
404. Restrictions/blocked pages are reported and the prospect is preserved.

Extraction is deterministic: title, description, selected JSON-LD, role-based business emails,
public phones, linked social channels, technology markers and ranked internal links.
Wix/Squarespace detection alone is not proof of ecommerce. WhatsApp contact does not prove ordering.
Signals are nullable: unknown is not false. Negative findings are emitted only after a readable,
completed bounded crawl; they describe those pages, not proof that the whole business lacks a feature.
SPA-only pages may stay partial. Raw HTML is never persisted or logged.

## Qualification and outreach

Weights and thresholds live in config.ts; scoring.ts is pure and deterministic, with a 0–100 cap.
Absence points require explicit false, never unknown or blocked. Recommendations only name existing
Lepefy capabilities. Nala/Referral/payments are not recommended without supporting evidence.
V1 has no AI dependency and sends no email. The structured Prospect/Evidence contract can support a
future optional AI Core consumer without sharing raw HTML.

Sales fields remain separate from enrichment. Suppression is preserved on rediscovery and excludes
both qualified enrichment and outbound-candidate selection; suppressed records remain reviewable.
Won does not create a tenant. Tenant onboarding/conversion remains a future explicit workflow.

## Validation

Unit tests use HTML fixtures and mocked provider/HTTP responses, including address pinning,
private redirect rejection, response bounds, 429, parsing, scoring, deduplication and denied routes.
SQL tests verify browser isolation, unique SIRET, duplicate-run protection, token ownership and
suppression. All validation runs in existing remote CI; no live external source is required.
