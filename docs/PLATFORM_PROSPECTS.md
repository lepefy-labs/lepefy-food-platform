# Platform prospects — Enrichment V2

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

## Enrichment lifecycle and optional providers

The module evolves the V1 implementation; discovery and the protected routes are preserved.
A known website is inspected first. Otherwise OSM is tried, then the discovered site is inspected.
Google Places is a last resort only when no website is available and the provider is configured.
A working website never triggers Google merely to fill a missing phone number.
BusinessLookupProvider separates lookups from orchestration; the website parser remains the
source of commercial observations.

“Enrichir les non vérifiés” selects collection state, never a score threshold. Manual selection
remains bounded to ten. Suppression applies to both paths. Candidates are read in bounded pages
(up to 5,000 scanned per selection) with unenriched records first, then catering, multiple locations,
available coordinates and oldest enrichment. Cooling records are skipped. The list exposes
collection and fit sorting explicitly; filters and counts are server-side. The legacy qualified
request flag is accepted as an alias for state-based selection, not score-based enrichment.

## OSM confidence matching

Overpass is queried only when coordinates exist and website/phone information is insufficient.
An exact SIRET is strongest (100); conflicting SIRETs are rejected. Names normalize case, accents,
punctuation and legal forms at token edges. Token Jaccard and two-token containment compare trade
and legal names without deleting commercial descriptors. Name evidence contributes up to 55,
distance up to 25, postcode 10, exact address 20 and compatible category 10 (non-SIRET cap 99).
Automatic matching requires 85, corroborating location and a 12-point margin over another candidate
at 65 or more. Distant (>200m), wrong-category, conflicting postcode/city/house-number candidates
are rejected. Overpass discovery radius remains 150m, maximum 50 records. Medium candidates retain
only ID/confidence/reasons; no fields are adopted. Confidence is a deterministic heuristic, not a
calibrated identity probability. No Nominatim bulk lookup is used. A failed OSM lookup cannot fail the entire pipeline.
OSM attribution/ID and opening hours are retained. Data: OpenStreetMap contributors, ODbL.
Provider endpoint: https://overpass-api.de/api/interpreter

## Google Places configuration and durable quota

Server-only configuration (disabled by default):

```env
GOOGLE_PLACES_API_KEY=
PLATFORM_PROSPECTS_GOOGLE_PLACES_ENABLED=false
PLATFORM_PROSPECTS_GOOGLE_PLACES_MONTHLY_LIMIT=900
```

Both the switch and key are required. Invalid limits fail closed; zero disables paid requests;
the maximum accepted limit is 10,000. This is a request budget, not a currency/free-tier guarantee.
Text Search (New) requests a narrow field mask including websiteUri, which is an Enterprise field.
Review the applicable Google pricing/terms before enabling it:
https://developers.google.com/maps/documentation/places/web-service/text-search
https://developers.google.com/maps/documentation/places/web-service/policies

Every HTTP attempt is preceded by an INSERT-only reservation in platform_prospect_cache:
quota:google:YYYY-MM:NNNNNN (UTC month). Unique keys prevent concurrent reuse. The next slot is
derived from the largest reserved slot; no upsert, refunds or retry of an unreserved request.
Five bounded contention retries fail closed. Storage errors and exhausted quota refuse requests.
Failed requests retain their reservation; the UI therefore reports reserved requests conservatively.
Reservations expire after the following month. Never delete or rewrite current-month quota keys;
generic cache cleanup must respect expires_at. There is no new table, RPC, migration or scheduler.

Google has a separate persistent rate gate and 429/503 backoff. Completed lookups have a 30-day
cooldown, failures one hour. No name-only match is accepted: the shared confidence matcher checks
address/postcode, coordinates, city and food category. Google response bodies, names, addresses,
phones and website URLs are not cached as provider records. Only place ID and our minimized
lookup diagnostics persist. A proposed URL is transient, bypasses the website-result cache, and is
adopted only after a complete direct crawl whose title independently matches the business.
Lasting contacts and commercial evidence come from that site. An unverified URL is discarded.
Google Maps is identified in the detail diagnostics; no Google map, review or photo is displayed.

## Website safety and evidence

Normal Node HTTP(S) GET only, explicit Lepefy User-Agent. No proxy, browser scraping, Google Maps,
LinkedIn, CAPTCHA-solving, authentication or protection bypass.
Only HTTP/HTTPS, default web ports, no credentials. Every connection and redirect validates DNS;
all answers must be public, and the socket uses the validated IP with original TLS hostname.
Private/local, metadata, reserved, mapped and transition networks are refused.
Responses have timeout, byte, encoding and content-type limits. gzip, deflate and Brotli use
standard Node decompression with maxOutputLength; both compressed and decoded bodies are capped
at the configured byte limit. Invalid/stacked encodings are refused. Robots redirects may follow
HTTP-to-HTTPS or www variants of the same hostname, with DNS/IP checks on every hop; cross-host
and HTTPS downgrade robots redirects remain refused. A website crawl has a bounded time
budget and visits at most homepage plus two same-origin relevant links; redirect hops are bounded.
Robots allow/disallow is checked per origin, including redirects. Robots errors fail closed except
404. Restrictions/blocked pages are reported and the prospect is preserved.

Extraction is deterministic: title, description, selected JSON-LD, role-based business emails,
public phones, linked social channels, technology markers and ranked internal links.
Wix/Squarespace detection alone is not proof of ecommerce. WhatsApp contact does not prove ordering.
Signals are nullable: unknown is not false. Negative findings are emitted only after a readable,
completed bounded crawl; they describe those pages, not proof that the whole business lacks a feature.
SPA-only pages may stay partial. Eatbu/DISH, Wix, Squarespace and link-in-bio hosting are observations,
not proof of ecommerce. External ordering links, request/confirmation forms and owned checkout
markers add minimized evidence. WhatsApp contact alone earns no ordering observation.
Raw HTML is never persisted or logged.

Failed/partial recrawls merge positive observations without deleting prior successful evidence,
contacts, technologies or successful-crawl timestamps. Latest attempt diagnostics are separate
from the last successful crawl. Existing contacts are never overwritten by providers. A manual
website change clears website-derived evaluation, including WhatsApp ordering, and records the
manual source; explicitly removing the site is respected. Enrichment and sales saves compare
updated_at so concurrent manual edits cannot be replaced by stale results.

## Completeness and maturity

assessment.ts derives quality without adding columns:
identity 10, address 10, coordinates 5, resolved site 10, phone 5, role email 5, social inspection 5,
seven commercial checks at 5 each, and completed crawl 15. The commercial checks are ecommerce,
ordering, delivery, events, catering, loyalty and WhatsApp ordering. An explicit website observation
or completed crawl is required; SIRENE catering alone does not fill the website checklist.
SIRENE-only identity/address/coordinates thus normally yield 25%, independently of a fit of 40.

Scores are provisional until a completed crawl within 14 days and completeness >=65.
Quality labels distinguish very low/low/medium/good/complete; collection distinguishes not started,
partial, complete, blocked, failed and stale. Last successful evidence remains available after a
failed attempt. The qualification badge is hidden behind “À enrichir” for provisional records;
the manual sales status remains separate.

Ordering maturity is unknown, none detected, request-based, transactional or integrated, inferred
from explicit form/checkout evidence. These are public-page observations, not an executed payment
test. Digital maturity is unknown/basic/fragmented/transactional/advanced. No website found does
not prove that a business has no digital presence. Fragmentation requires an external ordering
domain, or request-based ordering with a website and WhatsApp/hosted presence. Integrated ordering
plus observed loyalty is the conservative advanced case.

## Qualification and outreach

Weights and thresholds live in config.ts; scoring.ts is pure and deterministic, with a 0–100 cap.
Absence points require explicit false and a completed crawl, never unknown or blocked. Recommendations only name existing
Lepefy capabilities. Nala/Referral/payments are not recommended without supporting evidence.
V2 adds configurable opportunity weights for request-based ordering (10), fragmentation (10),
hosted presence (3) and explicit WhatsApp ordering (5); existing category weights and qualification
thresholds are unchanged. Digital activity is not penalized. The module has no AI dependency and sends no email. The structured Prospect/Evidence contract can support a
future optional AI Core consumer without sharing raw HTML.

Sales fields remain separate from enrichment. Suppression is preserved on rediscovery and excludes
both state-based enrichment and outbound-candidate selection; suppressed records remain reviewable.
Won does not create a tenant. Tenant onboarding/conversion remains a future explicit workflow.

Run cursors retain OSM matches/ambiguities, sites discovered/crawled/blocked, Google use/quota skips,
complete/partial/failed counts. The run panel and detail source diagnostics expose these without
logging HTML, credentials or business contact data.

## Validation

Unit tests use HTML fixtures and mocked provider/HTTP responses, including address pinning,
private redirect rejection, response bounds, 429, parsing, scoring, deduplication and denied routes.
SQL tests verify browser isolation, unique SIRET, duplicate-run protection, token ownership and
suppression. V2 adds deterministic trade-name matching, ambiguous/false-positive rejection,
SIRENE provisional assessment, fragmented/request ordering, compression bounds, quota contention,
disabled-provider and reserve-before-request tests, recrawl preservation, optimistic writes,
state-based selection and an OSM-to-website regression. All validation runs in existing remote CI; no live external source is required.
