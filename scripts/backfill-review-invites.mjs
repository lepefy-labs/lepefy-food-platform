const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tenantSlug = (process.env.REVIEW_BACKFILL_TENANT_SLUG ?? '').trim();
const requestedDays = Number.parseInt(process.env.REVIEW_BACKFILL_DAYS ?? '0', 10);
const lookbackDays = Math.min(30, Math.max(1, Number.isFinite(requestedDays) ? requestedDays : 0));

if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase credentials are required');
if (!tenantSlug) throw new Error('REVIEW_BACKFILL_TENANT_SLUG is required');
if (!Number.isFinite(requestedDays) || requestedDays < 1 || requestedDays > 30) {
  throw new Error('REVIEW_BACKFILL_DAYS must be between 1 and 30');
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  Accept: 'application/json',
};

async function supabaseGet(path) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase GET ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : [];
}

async function supabasePost(path, body, prefer = 'return=minimal') {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: prefer },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase POST ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function isApplicableOverride(row, nowMs) {
  if (!row) return null;
  const startsAt = row.starts_at ? new Date(row.starts_at).getTime() : null;
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
  if ((startsAt === null || startsAt <= nowMs) && (expiresAt === null || expiresAt > nowMs)) return Boolean(row.enabled);
  return null;
}

async function hasReviewsEntitlement(tenantId) {
  const overrideRows = await supabaseGet(`tenant_feature_overrides?select=enabled,starts_at,expires_at&tenant_id=eq.${encodeURIComponent(tenantId)}&feature_key=eq.reviews&limit=1`);
  const override = isApplicableOverride(overrideRows[0] ?? null, Date.now());
  if (override !== null) return override;

  const subscriptions = await supabaseGet(`tenant_subscriptions?select=plan_id,status&tenant_id=eq.${encodeURIComponent(tenantId)}&status=eq.active&limit=1`);
  const subscription = subscriptions[0];
  if (!subscription?.plan_id) return false;
  const planFeatures = await supabaseGet(`platform_plan_features?select=feature_key&plan_id=eq.${encodeURIComponent(subscription.plan_id)}&feature_key=eq.reviews&limit=1`);
  return planFeatures.length > 0;
}

function boundedNumber(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function chunks(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function existingOrderIds(table, tenantId, orderIds) {
  const found = new Set();
  for (const batch of chunks(orderIds)) {
    if (!batch.length) continue;
    const ids = batch.join(',');
    const rows = await supabaseGet(`${table}?select=order_id&tenant_id=eq.${encodeURIComponent(tenantId)}&review_type=eq.service&order_id=in.(${ids})`);
    for (const row of rows) if (row.order_id) found.add(row.order_id);
  }
  return found;
}

const tenants = await supabaseGet(`tenants?select=id,slug&slug=eq.${encodeURIComponent(tenantSlug)}&limit=1`);
const tenant = tenants[0];
if (!tenant) throw new Error(`Tenant not found for slug ${tenantSlug}`);

if (!(await hasReviewsEntitlement(tenant.id))) {
  console.log(`Review backfill skipped: tenant ${tenantSlug} has no active reviews entitlement.`);
  process.exit(0);
}

const settingsRows = await supabaseGet(`tenant_feature_settings?select=enabled,config&tenant_id=eq.${encodeURIComponent(tenant.id)}&feature_key=eq.reviews&limit=1`);
const setting = settingsRows[0];
if (!setting?.enabled) {
  console.log(`Review backfill skipped: reviews are operationally disabled for tenant ${tenantSlug}.`);
  process.exit(0);
}

const config = setting.konfig ?? {};
const requestDelayHours = boundedNumber(config.request_delay_hours, 24, 0, 168);
const reminderAfterDays = boundedNumber(config.reminder_after_days, 7, 1, 30);
const inviteExpiryDays = boundedNumber(config.invite_expiry_days, 30, 7, 90);
const now = new Date();
const sinceIso = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString();
const select = encodeURIComponent('id,tenant_id,customer_id,email,full_name,status,payment_status,updated_at');
const orders = await supabaseGet(`orders?select=${select}&tenant_id=eq.${encodeURIComponent(tenant.id)}&status=eq.delivered&payment_status=eq.paid&updated_at=gte.${encodeURIComponent(sinceIso)}&order=updated_at.asc&limit=500`);
const eligibleOrders = orders.filter((order) => typeof order.email === 'string' && order.email.trim());
const orderIds = eligibleOrders.map((order) => order.id);

if (!orderIds.length) {
  console.log(`Review backfill complete for ${tenantSlug}: no paid + delivered orders in the last ${lookbackDays} days.`);
  process.exit(0);
}

const [reviewedIds, invitedIds] = await Promise.all([
  existingOrderIds('reviews', tenant.id, orderIds),
  existingOrderIds('review_invites', tenant.id, orderIds),
]);

const rows = [];
let skippedExpired = 0;
for (const order of eligibleOrders) {
  if (reviewedIds.has(order.id) || invitedIds.has(order.id)) continue;
  const base = new Date(order.updated_at).getTime();
  if (!Number.isFinite(base)) continue;
  const eligibleAt = new Date(base + requestDelayHours * 3_600_000);
  const reminderAt = new Date(eligibleAt.getTime() + reminderAfterDays * 86_400_000);
  const expiresAt = new Date(eligibleAt.getTime() + inviteExpiryDays * 86_400_000);
  if (expiresAt.getTime() <= now.getTime()) {
    skippedExpired += 1;
    continue;
  }
  rows.push({
    tenant_id: tenant.id,
    order_id: order.id,
    customer_id: order.customer_id,
    email: order.email.trim().toLowerCase(),
    full_name: order.full_name,
    review_type: 'service',
    eligible_at: eligibleAt.toISOString(),
    reminder_at: reminderAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    updated_at: now.toISOString(),
  });
}

if (rows.length) {
  await supabasePost(
    'review_invites?on_conflict=tenant_id,order_id,review_type',
    rows,
    'resolution=ignore-duplicates,return=minimal',
  );
}

console.log(JSON.stringify({
  event: 'review_backfill_complete',
  tenant: tenantSlug,
  lookbackDays,
  eligibleOrders: eligibleOrders.length,
  alreadyReviewed: reviewedIds.size,
  alreadyInvited: invitedIds.size,
  createdCandidates: rows.length,
  skippedExpired,
}));
