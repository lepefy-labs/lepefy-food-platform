// Triggers /api/internal/shipping-postal-code-import once per country — same
// bearer-auth trigger pattern as process-shipping-sync.mjs. Run manually
// whenever the postal code index needs a (re)import, not on a schedule:
//   node scripts/import-postal-codes.mjs [COUNTRY...]
//   (defaults to IT FR DE BE CH)
const DEFAULT_COUNTRIES = ['IT', 'FR', 'DE', 'BE', 'CH'];

const appUrl = [process.env.SHIPPING_SYNC_APP_URL, process.env.AI_CORE_APP_URL,
  process.env.NALA_ENRICHMENT_APP_URL, process.env.EVENT_REPORTS_APP_URL]
  .find((value) => typeof value === 'string' && value.trim())?.trim();

async function importCountry(base, key, country) {
  const response = await fetch(new URL('/api/internal/shipping-postal-code-import', base), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90_000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ country }),
  });
  const result = await response.json();
  if (!response.ok || result?.ok !== true) throw new Error(`import_failed_${country}: ${result?.error ?? response.status}`);
  return result;
}

async function main() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('shipping_postal_code_import_credential_missing');
  const base = new URL(appUrl ?? '');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('shipping_postal_code_import_url_invalid');
  }

  const countries = process.argv.slice(2).length > 0
    ? process.argv.slice(2).map((c) => c.trim().toUpperCase())
    : DEFAULT_COUNTRIES;

  let hadFailure = false;
  for (const country of countries) {
    try {
      const result = await importCountry(base, key, country);
      console.log(`${country}: ${result.rowCount} postal code rows upserted.`);
    } catch (err) {
      hadFailure = true;
      console.error(`${country}: import failed —`, err instanceof Error ? err.message : err);
    }
  }
  if (hadFailure) process.exitCode = 1;
}

try { await main(); } catch (err) {
  console.error('Postal code import failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
