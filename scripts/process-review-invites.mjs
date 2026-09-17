const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase credentials are required');

const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: 'application/json' };
async function supabaseGet(path, { allowMissingReviewSchema = false } = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
  const text = await response.text();
  if (!response.ok) {
    if (allowMissingReviewSchema && (response.status === 404 || /review_invites|PGRST205|42P01/i.test(text))) return null;
    throw new Error(`Supabase ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : [];
}

const now = new Date();
const nowIso = now.toISOString();
const select = encodeURIComponent('id,tenant_id,eligible_at,reminder_at,expires_at,sent_at,reminder_sent_at,completed_at,processing_started_at');
const rows = await supabaseGet(`review_invites?select=${select}&completed_at=is.null&expires_at=gt.${encodeURIComponent(nowIso)}&order=eligible_at.asc&limit=100`, { allowMissingReviewSchema: true });
if (rows === null) {
  console.log('Review schema not available yet; skipping dispatcher.');
  process.exit(0);
}
const staleBefore = now.getTime() - 15 * 60 * 1000;
const due = rows.filter((row) => {
  const unlocked = !row.processing_started_at || new Date(row.processing_started_at).getTime() <= staleBefore;
  if (!unlocked) return false;
  if (!row.sent_at) return new Date(row.eligible_at).getTime() <= now.getTime();
  return !row.reminder_sent_at && new Date(row.reminder_at).getTime() <= now.getTime();
}).slice(0, 25);

if (!due.length) {
  console.log('No due review invitations.');
  process.exit(0);
}

const tenantIds = [...new Set(due.map((row) => row.tenant_id))];
const tenants = await supabaseGet(`tenants?select=id,storefront_url&id=in.(${tenantIds.join(',')})`);
const baseByTenant = new Map(tenants.map((tenant) => [tenant.id, tenant.storefront_url]));
let failures = 0;

for (const invite of due) {
  const base = String(baseByTenant.get(invite.tenant_id) ?? process.env.REVIEW_INVITES_APP_URL ?? process.env.SHIPPING_SYNC_APP_URL ?? '').replace(/\/$/, '');
  if (!/^https:\/\//i.test(base)) {
    console.error('No usable callback base URL for review invite', invite.id);
    failures += 1;
    continue;
  }
  try {
    const response = await fetch(`${base}/api/internal/review-invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ inviteId: invite.id }),
    });
    const text = await response.text();
    console.log(`Review invite ${invite.id}: ${response.status} ${text.slice(0, 300)}`);
    if (!response.ok && response.status !== 202) failures += 1;
  } catch (error) {
    console.error('Review invite dispatch failed', invite.id, error);
    failures += 1;
  }
}
if (failures > 0) process.exitCode = 1;
