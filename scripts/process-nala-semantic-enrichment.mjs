const appUrl = (
  process.env.NALA_ENRICHMENT_APP_URL
  ?? process.env.EVENT_REPORTS_APP_URL
  ?? ''
).replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!/^https:\/\//i.test(appUrl)) {
  throw new Error('A HTTPS NALA_ENRICHMENT_APP_URL or EVENT_REPORTS_APP_URL is required');
}
if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

const response = await fetch(`${appUrl}/api/internal/nala-semantic-enrichment`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ batchSize: 20 }),
});

const text = await response.text();
console.log(`Nala semantic enrichment: ${response.status} ${text.slice(0, 500)}`);
if (!response.ok) process.exitCode = 1;
