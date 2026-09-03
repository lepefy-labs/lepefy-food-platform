const rawBase = process.env.AI_BENCHMARK_APP_URL
  || process.env.NALA_ENRICHMENT_APP_URL
  || process.env.EVENT_REPORTS_APP_URL
  || '';
const token = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const modelKeys = (process.env.BENCHMARK_MODEL_KEYS || '')
  .split(',').map(value => value.trim()).filter(Boolean);
const requestedSampleSize = Number(process.env.BENCHMARK_SAMPLE_SIZE || '8');
const sampleSize = Number.isFinite(requestedSampleSize) ? requestedSampleSize : 8;

if (!/^https:\/\//i.test(rawBase)) {
  throw new Error('A HTTPS AI_BENCHMARK_APP_URL, NALA_ENRICHMENT_APP_URL or EVENT_REPORTS_APP_URL is required');
}
if (!token) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
if (modelKeys.length < 2) throw new Error('BENCHMARK_MODEL_KEYS must contain at least two comma-separated model keys');

const endpoint = `${rawBase.replace(/\/$/, '')}/api/internal/ai-provider-benchmark`;
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ modelKeys, sampleSize }),
});
const text = await response.text();
if (!response.ok) throw new Error(`AI provider benchmark: ${response.status} ${text}`);

let parsed;
try { parsed = JSON.parse(text); } catch { parsed = text; }
console.log('AI provider benchmark result:');
console.log(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2));
