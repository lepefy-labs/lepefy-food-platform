import Link from 'next/link';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { formatPrice } from '@/lib/utils/format';
import type { Order, OrderStatus, OrderItem } from '@lepefy/types';

export const dynamic = 'force-dynamic';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<OrderStatus, string> = {
  new:       'Nouveau',
  preparing: 'En préparation',
  shipped:   'Expédié',
  delivered: 'Livré',
  cancelled: 'Annulé',
};

const STATUS_BADGE: Record<OrderStatus, string> = {
  new:       'bg-gray-100 text-gray-700',
  preparing: 'bg-yellow-100 text-yellow-800',
  shipped:   'bg-blue-100 text-blue-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

const CARRIER_MAP: Record<string, string> = {
  'brt':            'BRT',
  'tnt':            'TNT',
  'ups':            'UPS',
  'dhl':            'DHL',
  'fedex':          'FedEx',
  'poste italiane': 'Poste Italiane',
  'sda':            'SDA',
  'inpost it':      'InPost',
};

const FLAG_MAP: Record<string, string> = {
  FR: '🇫🇷', BE: '🇧🇪', DE: '🇩🇪', CH: '🇨🇭',
  LU: '🇱🇺', NL: '🇳🇱', ES: '🇪🇸', PT: '🇵🇹',
  AT: '🇦🇹', GB: '🇬🇧',
};

function formatCarrierName(name: string | null | undefined): string {
  if (!name) return '—';
  return CARRIER_MAP[name.toLowerCase()] ?? name;
}

function formatProductsList(items: Pick<OrderItem, 'name' | 'quantity'>[]): string {
  if (!items?.length) return '—';
  if (items.length === 1) {
    const item = items[0];
    if (!item) return '—';
    return `${item.name} × ${item.quantity}`;
  }
  if (items.length <= 3) return items.map((i) => i.name).join(', ');
  return `${items.length} produits`;
}

function getDominantStorageType(
  items: Pick<OrderItem, 'storage_type'>[],
): 'dry' | 'fresh' | 'frozen' {
  if (items.some((i) => i.storage_type === 'frozen')) return 'frozen';
  if (items.some((i) => i.storage_type === 'fresh'))  return 'fresh';
  return 'dry';
}

const STORAGE_ICON: Record<string, string> = {
  frozen: '❄️',
  fresh:  '🌿',
  dry:    '',
};

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShippingDetails {
  carrierName?: string;
  numParcels?:  number;
}

interface ShippingAddress {
  country?: string;
}

type ListOrder = Pick<Order, 'id' | 'created_at' | 'email' | 'full_name' | 'status' | 'total' | 'fulfillment_type' | 'shipping_address'> & {
  shipping_details: ShippingDetails | null;
  order_items:      Pick<OrderItem, 'name' | 'quantity' | 'storage_type'>[];
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { status?: string; period?: string };
}) {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);
  const supabase = createServiceClient();

  // ── KPI data ────────────────────────────────────────────────────────────────
  const { data: allOrders } = await supabase
    .from('orders')
    .select('id, total, status, created_at')
    .eq('tenant_id', tenant.id)
    .eq('payment_status', 'paid') as {
      data: Pick<Order, 'id' | 'total' | 'status' | 'created_at'>[] | null;
    };

  const kpiOrders      = allOrders ?? [];
  const totalRevenue   = kpiOrders.reduce((s, o) => s + o.total, 0);
  const preparingCount = kpiOrders.filter((o) => o.status === 'preparing').length;
  const now            = new Date();
  const shippedThisMonth = kpiOrders.filter((o) => {
    const d = new Date(o.created_at);
    return (
      o.status === 'shipped' &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    );
  }).length;

  // ── Filtered list ────────────────────────────────────────────────────────────
  const filterStatus = searchParams.status as OrderStatus | undefined;
  const filterPeriod = searchParams.period ?? 'all';

  let query = supabase
    .from('orders')
    .select('id, created_at, email, full_name, status, total, shipping_details, fulfillment_type, shipping_address, order_items(name, quantity, storage_type)')
    .eq('tenant_id', tenant.id)
    .eq('payment_status', 'paid')
    .order('created_at', { ascending: false });

  if (filterStatus) query = query.eq('status', filterStatus);

  if (filterPeriod !== 'all') {
    const from = new Date();
    if (filterPeriod === 'today') { from.setHours(0, 0, 0, 0); }
    if (filterPeriod === 'week')  { from.setDate(from.getDate() - from.getDay()); }
    if (filterPeriod === 'month') { from.setDate(1); from.setHours(0, 0, 0, 0); }
    query = query.gte('created_at', from.toISOString());
  }

  const { data: listOrders } = await query as { data: ListOrder[] | null };
  const list = listOrders ?? [];

  // ── Filter URL builder ───────────────────────────────────────────────────────
  function filterUrl(params: Record<string, string | undefined>) {
    const merged = { status: filterStatus, period: filterPeriod, ...params };
    const p = new URLSearchParams();
    if (merged.status) p.set('status', merged.status);
    if (merged.period && merged.period !== 'all') p.set('period', merged.period);
    const qs = p.toString();
    return `/admin${qs ? '?' + qs : ''}`;
  }

  const statusFilters = [
    { key: '',          label: 'Tous' },
    { key: 'preparing', label: 'En préparation' },
    { key: 'shipped',   label: 'Expédié' },
    { key: 'delivered', label: 'Livré' },
    { key: 'cancelled', label: 'Annulé' },
  ];

  const periodFilters = [
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
        <KpiCard label="Commandes totales"  value={String(kpiOrders.length)} />
        <KpiCard label="Chiffre d'affaires" value={formatPrice(totalRevenue, tenant.currency)} />
        <KpiCard label="À expédier"         value={String(preparingCount)} />
        <KpiCard label="Expédiées ce mois"  value={String(shippedThisMonth)} />
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
        <span className="w-px bg-gray-200 mx-1 self-stretch" />
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
                  <th className="px-4 py-3 text-left font-medium hidden md:table-cell">Produits</th>
                  <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">Dest.</th>
                  <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">Transporteur</th>
                  <th className="px-4 py-3 text-left font-medium hidden xl:table-cell">Colis</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-left font-medium">Statut</th>
                  <th className="px-4 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {list.map((order) => {
                  const details  = order.shipping_details;
                  const items    = order.order_items ?? [];
                  const address  = order.shipping_address as ShippingAddress | null;
                  const country  = address?.country?.toUpperCase() ?? null;
                  const isPickup = order.fulfillment_type === 'pickup';
                  const storageType = getDominantStorageType(items);
                  const storageIcon = STORAGE_ICON[storageType];

                  const date = new Intl.DateTimeFormat('fr-FR', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  }).format(new Date(order.created_at));

                  return (
                    <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                      {/* N° ordre + storage icon */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-gray-500">
                            {order.id.slice(0, 8).toUpperCase()}
                          </span>
                          {storageIcon && (
                            <span title={storageType} className="text-sm leading-none">
                              {storageIcon}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{date}</td>

                      {/* Client */}
                      <td className="px-4 py-3">
                        {order.full_name && (
                          <p className="font-medium text-gray-900">{order.full_name}</p>
                        )}
                        <p className="text-gray-500 text-xs">{order.email}</p>
                      </td>

                      {/* Products */}
                      <td className="px-4 py-3 text-gray-600 text-xs max-w-[200px] hidden md:table-cell">
                        <span className="line-clamp-2">{formatProductsList(items)}</span>
                      </td>

                      {/* Destination */}
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {isPickup ? (
                          <span className="text-blue-600 text-xs font-medium">C&amp;C</span>
                        ) : country && country !== 'IT' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                            {FLAG_MAP[country] ?? '🌍'} {country}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">IT</span>
                        )}
                      </td>

                      {/* Carrier */}
                      <td className="px-4 py-3 text-gray-600 text-xs hidden lg:table-cell">
                        {isPickup ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          formatCarrierName(details?.carrierName)
                        )}
                      </td>

                      {/* Parcels */}
                      <td className="px-4 py-3 text-gray-600 text-xs hidden xl:table-cell">
                        {details?.numParcels ?? <span className="text-gray-300">—</span>}
                      </td>

                      {/* Total */}
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {formatPrice(order.total, tenant.currency)}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusBadge status={order.status as OrderStatus} />
                      </td>

                      {/* Action */}
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
