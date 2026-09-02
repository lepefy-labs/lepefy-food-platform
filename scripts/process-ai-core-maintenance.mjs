// Empty GitHub Actions variables must not mask the next configured fallback.
const appUrl = [
  process.env.AI_CORE_APP_URL,
  process.env.NALA_ENRICHMENT_APP_URL,
  process.env.EVENT_REPORTS_APP_URL,
].find(value => typeof value === 'string' && value.trim())?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  if (!serviceRoleKey) throw new Error('maintenance_credential_missing');
  let base;
  try { base = new URL(appUrl ?? ''); } catch { throw new Error('maintenance_url_invalid'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('maintenance_url_invalid');
  }
  const endpoint = base.toString().replace(/\/$/, '') + '/api/internal/ai-core-maintenance';
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(75_000),
    headers: { Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error('maintenance_request_failed');
  const result = await response.json();
  if (result?.ok !== true || !Number.isSafeInteger(result.deletedConversations) || result.deletedConversations < 0) {
    throw new Error('maintenance_result_invalid');
  }
  console.log(`AI Core maintenance succeeded: ${result.deletedConversations} conversations deleted.`);
}

try {
  await main();
} catch {
  // Never print URL, token, response body or raw transport/database exceptions.
  console.error('AI Core maintenance failed; check configured URL, credentials and sanitized server logs.');
  process.exitCode = 1;
}
