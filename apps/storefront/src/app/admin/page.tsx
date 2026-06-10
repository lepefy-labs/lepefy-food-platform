import Link from 'next/link';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { formatPrice } from '@/lib/utils/format';
import type { Order, OrderStatus } from '@lepefy/types';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<OrderStatus, string> = {
  new:        'Nouveau',
  preparing:  'En préparation',
  shipped:    'Expédié',
  delivered:  'Livré',
  cancelled:  'Annulé',
};

const STATUS_BADGE: Record<OrderStatus, string> = {
  new:        'bg-gray-100 text-gray-700',
  preparing:  'bg-yellow-100 text-yellow-800',
  shipped:    'bg-blue-100 text-blue-800',
  delivered:  'bg-green-100 text-green-800',
  cancelled:  'bg-red-100 text-red-800',
};

interface ShippingDetails {
  carrierName?:  string;
  numParcels?:   number;
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { status?: string; period?: string };
}) {
  const slug    = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant  = await getTenant(slug);
  const supabase = createServiceClient();

  // ── Fetch all paid orders for KPIs ──────────────────────────────────────
  const { data: allOrders } = await supabase
    .from('orders')
    .select('id, total, status, created_at')
    .eq('tenant_id', tenant.id)
    .eq('payment_status', 'paid') as { data: Pick<Order, 'id' | 'total' | 'status' | 'created_at'>[] | null };

  const orders = allOrders ?? [];

  const totalRevenue    = orders.reduce((s, o) => s + o.total, 0);
  const preparingCount  = orders.filter((o) => o.status === 'preparing').length;
  const now             = new Date();
  const shippedThisMonth = orders.filter((o) => {
    const d = new Date(o.created_at);
    return o.status === 'shipped' && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  // ── Filtered list ────────────────────────────────────────────────────────
  const filterStatus = searchParams.status as OrderStatus | undefined;
  const filterPeriod = searchParams.period ?? 'all';

  let query = supabase
    .from('orders')
    .select('id, created_at, email, full_name, status, total, shipping_details, fulfillment_type')
    .eq('tenant_id', tenant.id)
    .eq('payment_status', 'paid')
    .order('created_at', { ascending: false });

  if (filterStatus) query = query.eq('status', filterStatus);

  if (filterPeriod !== 'all') {
    const from = new Date();
    if (filterPeriod === 'today')  from.setHours(0, 0, 0, 0);
    if (filterPeriod === 'week')   from.setDate(from.getDate() - from.getDay());
    if (filterPeriod === 'month')  from.setDate(1), from.setHours(0, 0, 0, 0);
    query = query.gte('created_at', from.toISOString());
  }

  const { data: listOrders } = await query as {
    data: (Pick<Order, 'id' | 'created_at' | 'email' | 'full_name' | 'status' | 'total' | 'fulfillment_type'> & {
      shipping_details: ShippingDetails | null;
    })[] | null
  };

  const list = listOrders ?? [];

  // ── Build filter URLs ────────────────────────────────────────────────────
  function filterUrl(params: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const merged = { status: filterStatus, period: filterPeriod, ...params };
    if (merged.status) p.set('status', merged.status);
    if (merged.period && merged.period !== 'all') p.set('period', merged.period);
    const qs = p.toString();
    return `/admin${qs ? '?' + qs : ''}`;
  }

  const statusFilters: { key: string; label: string }[] = [
    { key: '',           label: 'Tous' },
    { key: 'preparing',  label: 'En préparation' },
    { key: 'shipped',    label: 'Expédié' },
    { key: 'delivered',  label: 'Livré' },
    { key: 'cancelled',  label: 'Annulé' },
  ];

  const periodFilters: { key: string; label: string }[] = [
    { key: 'all',   label: 'Toutes les dates' },
    { key: 'today', label: "Aujourd'hui" },
    { key: 'week',  label: 'Cette semaine' },
    { key: 'month', label: 'Ce mois' },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Commandes</h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Commandes totales"      value={String(orders.length)} />
        <KpiCard label="Chiffre d'affaires"     value={formatPrice(totalRevenue, tenant.currency)} />
        <KpiCard label="À expédier"             value={String(preparingCount)} />
        <KpiCard label="Expédiées ce mois"      value={String(shippedThisMonth)} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {statusFilters.map((f) => (
          <Link
            key={f.key}
            href={filterUrl({ status: f.key || undefined, period: filterPeriod !== 'all' ? filterPeriod : undefined })}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              (filterStatus ?? '') === f.key
                ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary-light)]'
                : 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50'
            }`}
          >
            {f.label}
          </Link>
        ))}
        <span className="w-px bg-gray-200 mx-1" />
        {periodFilters.map((f) => (
          <Link
            key={f.key}
            href={filterUrl({ status: filterStatus, period: f.key !== 'all' ? f.key : undefined })}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filterPeriod === f.key
                ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary-light)]'
                : 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Orders table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {list.length === 0 ? (
          <p className="text-center text-gray-400 py-12 text-sm">Aucune commande trouvée.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left font-medium">N° ordre</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Client</th>
                  <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">Transporteur</th>
                  <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">Colis</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-left font-medium">Statut</th>
                  <th className="px-4 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {list.map((order) => {
                  const details = order.shipping_details as ShippingDetails | null;
                  const date    = new Intl.DateTimeFormat('fr-FR', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  }).format(new Date(order.created_at));

                  return (
                    <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {order.id.slice(0, 8).toUpperCase()}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{date}</td>
                      <td className="px-4 py-3">
                        {order.full_name && <p className="font-medium text-gray-900">{order.full_name}</p>}
                        <p className="text-gray-500 text-xs">{order.email}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                        {order.fulfillment_type === 'pickup'
                          ? <span className="text-blue-600 text-xs font-medium">Click &amp; Collect</span>
                          : (details?.carrierName ?? <span className="text-gray-300">—</span>)
                        }
                      </td>
                      <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                        {details?.numParcels ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {formatPrice(order.total, tenant.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={order.status as OrderStatus} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                        >
                          Voir →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
