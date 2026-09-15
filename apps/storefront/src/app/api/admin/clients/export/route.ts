import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCustomers } from '@/lib/admin/crm';

function csv(value: unknown) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }

export async function GET(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'); const denied = await requireAdmin(tenant.id); if (denied) return denied;
  const p = req.nextUrl.searchParams;
  const rows: any[] = []; let page = 1; let total = 0;
  do {
    const result = await getCustomers(tenant.id, {
      q: p.get('q') ?? undefined, segment: p.get('segment') ?? undefined, source: p.get('source') ?? undefined,
      marketing: p.has('marketing') ? p.get('marketing') === 'true' : undefined,
      loyalty: p.has('loyalty') ? p.get('loyalty') === 'true' : undefined,
      minOrders: p.has('minOrders') ? Number(p.get('minOrders')) : undefined,
      maxOrders: p.has('maxOrders') ? Number(p.get('maxOrders')) : undefined,
      minLifetimeValue: p.has('minLifetimeValue') ? Number(p.get('minLifetimeValue')) : undefined,
      createdAfter: p.get('createdAfter') ?? undefined, createdBefore: p.get('createdBefore') ?? undefined,
      lastPurchaseBefore: p.get('lastPurchaseBefore') ?? undefined, tagId: p.get('tagId') ?? undefined,
      sort: (p.get('sort') as any) ?? undefined, direction: p.get('direction') === 'asc' ? 'asc' : 'desc', page, pageSize: 100,
    });
    rows.push(...result.customers); total = result.count; page += 1;
  } while (rows.length < total && rows.length < 10000);
  const header = ['Nom','E-mail','Téléphone','Source','Commandes','Dépensé','Dernier achat','Points fidélité','Consentement marketing'];
  const body = rows.map((r) => [r.full_name,r.email,r.phone,r.source,r.completed_orders_count,r.lifetime_value,r.last_order_at,r.loyalty_points_balance,r.marketing_consent ? 'Autorisé' : 'Non autorisé'].map(csv).join(','));
  return new NextResponse(`\uFEFF${header.map(csv).join(',')}\n${body.join('\n')}`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="clients-${new Date().toISOString().slice(0,10)}.csv"` } });
}
