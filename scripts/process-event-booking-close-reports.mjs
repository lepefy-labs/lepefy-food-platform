const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase credentials are required');

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  Accept: 'application/json',
};

async function supabaseGet(path) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

const now = new Date().toISOString();
const select = encodeURIComponent('id,tenant_id,booking_close_reports_dispatch_token,booking_close_reports_scheduled_for,date_start');
const events = await supabaseGet(`events?select=${select}&booking_close_reports_scheduled_for=lte.${encodeURIComponent(now)}&date_start=gt.${encodeURIComponent(now)}&booking_close_reports_sent_at=is.null&order=booking_close_reports_scheduled_for.asc&limit=25`);

if (!events.length) {
  console.log('No due event booking-close reports.');
  process.exit(0);
}

const tenantIds = [...new Set(events.map((event) => event.tenant_id))];
const tenantFilter = tenantIds.join(',');
const tenants = await supabaseGet(`tenants?select=id,storefront_url&id=in.(${encodeURIComponent(tenantFilter)})`);
const baseByTenant = new Map(tenants.map((tenant) => [tenant.id, tenant.storefront_url]));
let failures = 0;

for (const event of events) {
  const base = String(baseByTenant.get(event.tenant_id) ?? process.env.EVENT_REPORTS_APP_URL ?? '').replace(/\/$/, '');
  if (!/^https:\/\//i.test(base)) {
    console.error('No usable callback base URL for event', event.id);
    failures += 1;
    continue;
  }
  try {
    const response = await fetch(`${base}/api/events/internal/booking-close-reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: event.id, dispatchToken: event.booking_close_reports_dispatch_token }),
    });
    const text = await response.text();
    console.log(`Event ${event.id}: ${response.status} ${text.slice(0, 300)}`);
    if (!response.ok && response.status !== 202) failures += 1;
  } catch (dispatchError) {
    console.error('Dispatch failed for event', event.id, dispatchError);
    failures += 1;
  }
}

if (failures > 0) process.exitCode = 1;
