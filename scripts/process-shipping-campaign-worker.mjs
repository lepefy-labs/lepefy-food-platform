// URL fallbacks must refer to the same storefront deployment (worker is per-tenant, same app).
const appUrl = [process.env.SHIPPING_SYNC_APP_URL, process.env.AI_CORE_APP_URL,
  process.env.NALA_ENRICHMENT_APP_URL, process.env.EVENT_REPORTS_APP_URL]
  .find(value => typeof value === 'string' && value.trim())?.trim();
async function main() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('shipping_campaign_worker_credential_missing');
  const base = new URL(appUrl ?? '');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('shipping_campaign_worker_url_invalid');
  const response = await fetch(new URL('/api/internal/shipping-campaign-worker', base), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(75_000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!response.ok) throw new Error('shipping_campaign_worker_request_failed');
  const result = await response.json();
  if (result?.ok !== true) throw new Error('shipping_campaign_worker_result_invalid');
  console.log(`Shipping campaign worker: ${result.processed ?? 0} processed, ${result.succeeded ?? 0} succeeded, ${result.failed ?? 0} failed, ${result.skipped ?? 0} skipped (duplicate).`);
  if ((result.failed ?? 0) > 0) process.exitCode = 1;
}
try { await main(); } catch {
  // Never log credentials, URLs, raw provider bodies or transport exceptions.
  console.error('Shipping campaign worker failed; check configured URL, credentials and sanitized server logs.');
  process.exitCode = 1;
}
