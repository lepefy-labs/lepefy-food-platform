import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { formatPrice } from '@/lib/utils/format';
import { cardPaymentReference } from '@/lib/card/cardPaymentOutcome';
import { referenceRange } from '@/lib/card/cardPaymentsAdmin';
import { isBusinessManagementEnabled } from '@/lib/gestion/featureGate';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

type Scope = 'orders' | 'products' | 'events' | 'customers' | 'suppliers' | 'purchases';
const ALL_SCOPES: Scope[] = ['orders', 'products', 'events', 'customers', 'suppliers', 'purchases'];
const SCOPE_PERMISSION: Record<Scope, string> = {
  orders: 'orders.view',
  products: 'catalog.view',
  events: 'events.view',
  customers: 'customers.view',
  suppliers: 'suppliers.view',
  purchases: 'purchases.view',
};
// Gestion scopes also need the business_management release flag (404 elsewhere).
const GESTION_SCOPES: Scope[] = ['suppliers', 'purchases'];

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
  const permitted = requestedScopes.filter((scope) => canAdmin(access, SCOPE_PERMISSION[scope]));
  const gestionEnabled = permitted.some((scope) => GESTION_SCOPES.includes(scope)) && await isBusinessManagementEnabled(tenant.id);
  const scopes = permitted.filter((scope) => gestionEnabled || !GESTION_SCOPES.includes(scope));

  const empty: Record<Scope, SearchResultItem[]> = { orders: [], products: [], events: [], customers: [], suppliers: [], purchases: [] };
  if (scopes.length === 0) return NextResponse.json({ query: q, results: empty });
  if (q.length < 2) return NextResponse.json({ query: q, results: empty });

  const supabase = createServiceClient();
  const like = `%${q}%`;
  const LIMIT = 5;
  const results: Record<Scope, SearchResultItem[]> = { ...empty };

  await Promise.all([
    scopes.includes('orders')
      ? (async () => {
          // A /card reference (CP-XXXXXX) given by a customer leads to Paiements carte.
          const range = referenceRange(q);
          const cardPayments = range
            ? (await supabase.from('tenant_card_payments').select('id, amount, customer_name, status').eq('tenant_id', tenant.id)
              .gte('id', range.from).lte('id', range.to).limit(LIMIT)).data ?? []
            : [];
          const cardResults = (cardPayments as Array<{ id: string; amount: number; customer_name: string | null; status: string }>).map((payment) => ({
            id: payment.id,
            label: `${cardPaymentReference(payment.id)} — Paiement carte${payment.customer_name ? ` · ${payment.customer_name}` : ''}`,
            sublabel: `${formatPrice(Number(payment.amount), tenant.currency)} · ${payment.status === 'paid' ? 'Payé' : 'Non finalisé'}`,
            href: `/admin/paiements-carte?q=${cardPaymentReference(payment.id)}`,
          }));
          const [byName, byEmail] = await Promise.all([
            supabase.from('orders').select('id, full_name, email, total, created_at').eq('tenant_id', tenant.id).ilike('full_name', like).order('created_at', { ascending: false }).limit(LIMIT),
            supabase.from('orders').select('id, full_name, email, total, created_at').eq('tenant_id', tenant.id).ilike('email', like).order('created_at', { ascending: false }).limit(LIMIT),
          ]);
          type OrderRow = { id: string; full_name: string | null; email: string; total: number; created_at: string };
          const merged = new Map<string, OrderRow>();
          for (const row of [...(byName.data ?? []), ...(byEmail.data ?? [])] as OrderRow[]) merged.set(row.id, row);
          results.orders = [...cardResults, ...[...merged.values()].map((order) => ({
            id: order.id,
            label: `#${order.id.slice(0, 8).toUpperCase()} — ${order.full_name ?? order.email}`,
            sublabel: formatPrice(order.total, tenant.currency),
            href: `/admin/orders/${order.id}`,
          }))].slice(0, LIMIT);
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
          results.customers = [...merged.values()].slice(0, LIMIT).map((customer) => ({ id: customer.id, label: customer.full_name ?? customer.email ?? customer.phone ?? 'Client', sublabel: customer.full_name ? customer.email : customer.phone, href: `/admin/clients/${customer.id}` }));
        })()
      : Promise.resolve(),
    scopes.includes('suppliers')
      ? (async () => {
          const [byName, byCode] = await Promise.all([
            supabase.from('suppliers').select('id, code, name, contact_name').eq('tenant_id', tenant.id).ilike('name', like).order('name').limit(LIMIT),
            supabase.from('suppliers').select('id, code, name, contact_name').eq('tenant_id', tenant.id).ilike('code', like).order('name').limit(LIMIT),
          ]);
          type SupplierRow = { id: string; code: string | null; name: string; contact_name: string | null };
          const merged = new Map<string, SupplierRow>();
          for (const row of [...(byName.data ?? []), ...(byCode.data ?? [])] as SupplierRow[]) merged.set(row.id, row);
          results.suppliers = [...merged.values()].slice(0, LIMIT).map((supplier) => ({ id: supplier.id, label: supplier.name, sublabel: supplier.code ?? supplier.contact_name, href: `/admin/gestion/fournisseurs/${supplier.id}` }));
        })()
      : Promise.resolve(),
    scopes.includes('purchases')
      ? (async () => {
          const { data } = await supabase.from('supplier_purchases').select('id, reference, supplier_reference, total, currency, suppliers(name)')
            .eq('tenant_id', tenant.id).or(`reference.ilike.${like},supplier_reference.ilike.${like}`).order('order_date', { ascending: false }).limit(LIMIT);
          type PurchaseRow = { id: string; reference: string; supplier_reference: string | null; total: number; currency: string; suppliers: { name: string } | { name: string }[] | null };
          results.purchases = ((data ?? []) as PurchaseRow[]).map((purchase) => {
            const supplier = Array.isArray(purchase.suppliers) ? purchase.suppliers[0] : purchase.suppliers;
            return { id: purchase.id, label: `${purchase.reference}${supplier ? ` — ${supplier.name}` : ''}`, sublabel: formatPrice(Number(purchase.total), purchase.currency || tenant.currency), href: `/admin/gestion/achats/${purchase.id}` };
          });
        })()
      : Promise.resolve(),
  ]);

  return NextResponse.json({ query: q, results });
}
