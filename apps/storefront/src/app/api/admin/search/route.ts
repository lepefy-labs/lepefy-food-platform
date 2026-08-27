import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { formatPrice } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

type Scope = 'orders' | 'products' | 'events' | 'customers';
const ALL_SCOPES: Scope[] = ['orders', 'products', 'events', 'customers'];
const SCOPE_PERMISSION: Record<Scope, string> = {
  orders: 'orders.view',
  products: 'catalog.view',
  events: 'events.view',
  customers: 'orders.view',
};

interface SearchResultItem {
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
}

function sanitizeQuery(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9À-ÿ@._\- ]/g, '').slice(0, 60);
}

export async function GET(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access) return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });

  const q = sanitizeQuery(req.nextUrl.searchParams.get('q') ?? '');
  const scopeParam = req.nextUrl.searchParams.get('scope');
  const requestedScopes = scopeParam
    ? scopeParam.split(',').filter((scope): scope is Scope => ALL_SCOPES.includes(scope as Scope))
    : ALL_SCOPES;
  const scopes = requestedScopes.filter((scope) => canAdmin(access, SCOPE_PERMISSION[scope]));

  const empty: Record<Scope, SearchResultItem[]> = { orders: [], products: [], events: [], customers: [] };
  if (scopes.length === 0) return NextResponse.json({ query: q, results: empty });
  if (q.length < 2) return NextResponse.json({ query: q, results: empty });

  const supabase = createServiceClient();
  const like = `%${q}%`;
  const LIMIT = 5;
  const results: Record<Scope, SearchResultItem[]> = { ...empty };

  await Promise.all([
    scopes.includes('orders')
      ? (async () => {
          const [byName, byEmail] = await Promise.all([
            supabase.from('orders').select('id, full_name, email, total, created_at').eq('tenant_id', tenant.id).ilike('full_name', like).order('created_at', { ascending: false }).limit(LIMIT),
            supabase.from('orders').select('id, full_name, email, total, created_at').eq('tenant_id', tenant.id).ilike('email', like).order('created_at', { ascending: false }).limit(LIMIT),
          ]);
          type OrderRow = { id: string; full_name: string | null; email: string; total: number; created_at: string };
          const merged = new Map<string, OrderRow>();
          for (const row of [...(byName.data ?? []), ...(byEmail.data ?? [])] as OrderRow[]) merged.set(row.id, row);
          results.orders = [...merged.values()].slice(0, LIMIT).map((order) => ({
            id: order.id,
            label: `#${order.id.slice(0, 8).toUpperCase()} — ${order.full_name ?? order.email}`,
            sublabel: formatPrice(order.total, tenant.currency),
            href: `/admin/orders/${order.id}`,
          }));
        })()
      : Promise.resolve(),
    scopes.includes('products')
      ? (async () => {
          const { data } = await supabase.from('products').select('id, name, price').eq('tenant_id', tenant.id).ilike('name', like).order('name', { ascending: true }).limit(LIMIT);
          results.products = (data ?? []).map((product) => ({ id: product.id, label: product.name, sublabel: formatPrice(product.price, tenant.currency), href: `/admin/catalogue/${product.id}` }));
        })()
      : Promise.resolve(),
    scopes.includes('events')
      ? (async () => {
          const { data } = await supabase.from('events').select('id, title, date_start').eq('tenant_id', tenant.id).ilike('title', like).order('date_start', { ascending: false }).limit(LIMIT);
          results.events = (data ?? []).map((event) => ({ id: event.id, label: event.title, sublabel: new Date(event.date_start).toLocaleDateString('fr-FR'), href: `/admin/evenementiel/evenements/${event.id}` }));
        })()
      : Promise.resolve(),
    scopes.includes('customers')
      ? (async () => {
          const [byName, byEmail] = await Promise.all([
            supabase.from('customers').select('id, full_name, email, phone').eq('tenant_id', tenant.id).ilike('full_name', like).limit(LIMIT),
            supabase.from('customers').select('id, full_name, email, phone').eq('tenant_id', tenant.id).ilike('email', like).limit(LIMIT),
          ]);
          type CustomerRow = { id: string; full_name: string | null; email: string; phone: string | null };
          const merged = new Map<string, CustomerRow>();
          for (const row of [...(byName.data ?? []), ...(byEmail.data ?? [])] as CustomerRow[]) merged.set(row.id, row);
          results.customers = [...merged.values()].slice(0, LIMIT).map((customer) => ({ id: customer.id, label: customer.full_name ?? customer.email, sublabel: customer.full_name ? customer.email : customer.phone, href: `mailto:${customer.email}` }));
        })()
      : Promise.resolve(),
  ]);

  return NextResponse.json({ query: q, results });
}
