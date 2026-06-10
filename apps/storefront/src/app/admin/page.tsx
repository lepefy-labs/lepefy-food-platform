import Link from 'next/link';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { formatPrice } from '@/lib/utils/format';
import type { Order, OrderStatus, OrderItem } from '@lepefy/types';

export const dynamic = 'force-dynamic';

// ─── Flag SVGs ────────────────────────────────────────────────────────────────

const FLAGS: Record<string, React.ReactElement> = {
  FR: (
    <svg width="20" height="14" viewBox="0 0 20 14" style={{ borderRadius: 2, flexShrink: 0 }}>
      <rect width="7"  height="14" fill="#002395" />
      <rect x="7"  width="6"  height="14" fill="#fff" />
      <rect x="13" width="7"  height="14" fill="#ED2939" />
    </svg>
  ),
  BE: (
    <svg width="20" height="14" viewBox="0 0 20 14" style={{ borderRadius: 2, flexShrink: 0 }}>
      <rect width="7"  height="14" fill="#1E1E1E" />
      <rect x="7"  width="6"  height="14" fill="#FAE042" />
      <rect x="13" width="7"  height="14" fill="#CC0001" />
    </svg>
  ),
  DE: (
    <svg width="20" height="14" viewBox="0 0 20 14" style={{ borderRadius: 2, flexShrink: 0 }}>
      <rect width="20" height="5"  fill="#1E1E1E" />
      <rect y="5"  width="20" height="4"  fill="#DD0000" />
      <rect y="9"  width="20" height="5"  fill="#FFCE00" />
    </svg>
  ),
  CH: (
    <svg width="14" height="14" viewBox="0 0 14 14" style={{ borderRadius: 2, flexShrink: 0 }}>
      <rect width="14" height="14" fill="#FF0000" />
      <rect x="6" y="2" width="2"  height="10" fill="#fff" />
      <rect x="2" y="6" width="10" height="2"  fill="#fff" />
    </svg>
  ),
  LU: (
    <svg width="20" height="14" viewBox="0 0 20 14" style={{ borderRadius: 2, flexShrink: 0 }}>
      <rect width="20" height="5"  fill="#EF3340" />
      <rect y="5"  width="20" height="4"  fill="#fff" />
      <rect y="9"  width="20" height="5"  fill="#00A3E0" />
    </svg>
  ),
  NL: (
    <svg width="20" height="14" viewBox="0 0 20 14" style={{ borderRadius: 2, flexShrink: 0 }}>
      <rect width="20" height="5"  fill="#AE1C28" />
      <rect y="5"  width="20" height="4"  fill="#fff" />
      <rect y="9"  width="20" height="5"  fill="#21468B" />
    </svg>
  ),
  ES: (
    <svg width="20" height="14" viewBox="0 0 20 14" style={{ borderRadius: 2, flexShrink: 0 }}>
      <rect width="20" height="3"  fill="#AA151B" />
      <rect y="3"  width="20" height="8"  fill="#F1BF00" />
      <rect y="11" width="20" height="3"  fill="#AA151B" />
    </svg>
  ),
  PT: (
    <svg width="20" height="14" viewBox="0 0 20 14" style={{ borderRadius: 2, flexShrink: 0 }}>
      <rect width="8"  height="14" fill="#006600" />
      <rect x="8" width="12" height="14" fill="#FF0000" />
    </svg>
  ),
};

const FLAG_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  FR: { bg: '#EEF2FF', color: '#1E3A8A', border: '#BFDBFE' },
  BE: { bg: '#FEFCE8', color: '#854D0E', border: '#FDE68A' },
  DE: { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' },
  CH: { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' },
  LU: { bg: '#EEF2FF', color: '#1E3A8A', border: '#BFDBFE' },
  NL: { bg: '#EEF2FF', color: '#1E3A8A', border: '#BFDBFE' },
  ES: { bg: '#FEFCE8', color: '#854D0E', border: '#FDE68A' },
  PT: { bg: '#F0FDF4', color: '#166534', border: '#BBF7D0' },
};

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

function formatCarrierName(name: string | null | undefined): string {
  if (!name) return '—';
  return CARRIER_MAP[name.toLowerCase()] ?? name;
}

function StorageTag({ type }: { type: 'frozen' | 'fresh' }) {
  const styles = {
    frozen: { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE', label: '❄ surgelé' },
    fresh:  { bg: '#F0FDF4', color: '#166534', border: '#BBF7D0', label: '🌿 frais'  },
  };
  const s = styles[type];
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 600,
      padding: '1px 5px', borderRadius: 3, marginRight: 3,
      background: s.bg, color: s.color, border: `0.5px solid ${s.border}`,
    }}>
      {s.label}
    </span>
  );
}

function ProductsCell({ items }: { items: Pick<OrderItem, 'name' | 'storage_type'>[] }) {
  const MAX   = 3;
  const names = items.slice(0, MAX).map((i) => i.name).join(', ');
  const extra = items.length > MAX ? ` + ${items.length - MAX} autres` : '';
  const hasFrozen = items.some((i) => i.storage_type === 'frozen');
  const hasFresh  = items.some((i) => i.storage_type === 'fresh');

  return (
    <div>
      <span style={{ fontSize: 12, color: '#6B7280' }}>
        {names}
        {extra && <span style={{ color: '#9CA3AF' }}>{extra}</span>}
      </span>
      {(hasFrozen || hasFresh) && (
        <div style={{ marginTop: 3 }}>
          {hasFrozen && <StorageTag type="frozen" />}
          {hasFresh  && <StorageTag type="fresh"  />}
        </div>
      )}
    </div>
  );
}

function DestinationCell({
  fulfillmentType,
  shippingAddress,
}: {
  fulfillmentType: string;
  shippingAddress: { country?: string; city?: string; postal_code?: string } | null;
}) {
  if (fulfillmentType === 'pickup') {
    return <span className="text-xs text-blue-600 font-medium">🏪 Click & Collect</span>;
  }

  const country = shippingAddress?.country?.toUpperCase() ?? null;

  if (!country || country === 'IT') {
    const city    = shippingAddress?.city ?? '';
    const postal  = shippingAddress?.postal_code ?? '';
    const label   = [city, postal].filter(Boolean).join(' ');
    return <span className="text-xs text-gray-400">{label || 'IT'}</span>;
  }

  const flag  = FLAGS[country];
  const style = FLAG_STYLES[country] ?? { bg: '#F3F4F6', color: '#374151', border: '#D1D5DB' };

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 600, padding: '2px 7px 2px 3px',
      borderRadius: 4, border: `0.5px solid ${style.border}`,
      background: style.bg, color: style.color,
    }}>
      {flag ?? '🌍'} {country}
    </span>
  );
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShippingDetails {
  carrierName?: string;
  numParcels?:  number;
}

interface ShippingAddress {
  country?:     string;
  city?:        string;
  postal_code?: string;
}

type ListOrder = Pick<Order, 'id' | 'created_at' | 'email' | 'full_name' | 'status' | 'total' | 'fulfillment_type'> & {
  shipping_details: ShippingDetails | null;
  shipping_address: ShippingAddress | null;
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
                  <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">Transporteur</th>
                  <th className="px-4 py-3 text-left font-medium hidden xl:table-cell">Colis</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-left font-medium">Statut</th>
                  <th className="px-4 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {list.map((order) => {
                  const details = order.shipping_details;
                  const items   = order.order_items ?? [];

                  const date = new Intl.DateTimeFormat('fr-FR', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  }).format(new Date(order.created_at));

                  return (
                    <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                      {/* N° ordre */}
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">
                        {order.id.slice(0, 8).toUpperCase()}
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">{date}</td>

                      {/* Client + destination */}
                      <td className="px-4 py-3">
                        {order.full_name && (
                          <p className="font-medium text-gray-900 text-sm leading-tight">{order.full_name}</p>
                        )}
                        <p className="text-gray-500 text-xs">{order.email}</p>
                        <div className="mt-1">
                          <DestinationCell
                            fulfillmentType={order.fulfillment_type}
                            shippingAddress={order.shipping_address}
                          />
                        </div>
                      </td>

                      {/* Products */}
                      <td className="px-4 py-3 hidden md:table-cell max-w-[220px]">
                        <ProductsCell items={items} />
                      </td>

                      {/* Carrier */}
                      <td className="px-4 py-3 text-gray-600 text-xs hidden lg:table-cell whitespace-nowrap">
                        {order.fulfillment_type === 'pickup'
                          ? <span className="text-gray-300">—</span>
                          : formatCarrierName(details?.carrierName)
                        }
                      </td>

                      {/* Parcels */}
                      <td className="px-4 py-3 text-gray-600 text-xs hidden xl:table-cell">
                        {details?.numParcels ?? <span className="text-gray-300">—</span>}
                      </td>

                      {/* Total */}
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
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
                          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors whitespace-nowrap"
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
