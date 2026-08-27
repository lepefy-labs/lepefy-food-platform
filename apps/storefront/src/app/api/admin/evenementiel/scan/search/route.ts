import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requirePermission } from '@/lib/auth/adminRbac';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requirePermission(tenant.id, 'scan.search');
  if (denied) return denied;

  if (!tenant.events_enabled) {
    return NextResponse.json({ error: 'Module événementiel non activé.' }, { status: 400 });
  }

  const eventId = req.nextUrl.searchParams.get('event_id')?.trim() ?? '';
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!eventId || q.length < 2) {
    return NextResponse.json({ error: 'Événement et recherche de 2 caractères minimum requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: event } = await supabase
    .from('events')
    .select('id, tenant_id')
    .eq('id', eventId)
    .maybeSingle();

  if (!event || event.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });
  }

  const select = 'id, customer_name, customer_email, customer_phone, qr_token, quantity_total, quantity_remaining, status, created_at';
  const base = () => supabase
    .from('event_reservations')
    .select(select)
    .eq('tenant_id', tenant.id)
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(8);

  const searches = [
    base().ilike('customer_name', `%${q}%`),
    base().ilike('customer_email', `%${q}%`),
    base().ilike('customer_phone', `%${q}%`),
    base().ilike('qr_token', `%${q}%`),
  ];
  if (UUID_RE.test(q)) searches.push(base().eq('id', q));

  const responses = await Promise.all(searches);
  const firstError = responses.find(response => response.error)?.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });

  const byId = new Map<string, Record<string, unknown>>();
  for (const response of responses) {
    for (const row of response.data ?? []) byId.set(row.id as string, row as Record<string, unknown>);
  }

  const results = [...byId.values()]
    .sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime())
    .slice(0, 10)
    .map(row => ({
      id: String(row.id),
      customer_name: String(row.customer_name ?? 'Réservation'),
      customer_email: String(row.customer_email ?? ''),
      customer_phone: row.customer_phone ? String(row.customer_phone) : null,
      qr_token: String(row.qr_token),
      quantity_total: Number(row.quantity_total || 0),
      quantity_remaining: Number(row.quantity_remaining || 0),
      status: String(row.status),
      reference: String(row.id).slice(0, 8).toUpperCase(),
    }));

  return NextResponse.json({ results });
}
