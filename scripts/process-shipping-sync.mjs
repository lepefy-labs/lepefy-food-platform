const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = process.env.SHIPPING_SYNC_APP_URL
  || process.env.EVENT_REPORTS_APP_URL
  || process.env.NALA_ENRICHMENT_APP_URL;

if (!serviceRoleKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required.');
  process.exit(1);
}
if (!appUrl) {
  console.error('SHIPPING_SYNC_APP_URL (or a compatible app URL fallback) is required.');
  process.exit(1);
}

const endpoint = new URL('/api/internal/shipping-sync', appUrl).toString();
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: 'application/json',
  },
});

const text = await response.text();
if (!response.ok) {
  console.error(`Shipping sync failed: HTTP ${response.status} ${text.slice(0, 1000)}`);
  process.exit(1);
}

console.log(text);
