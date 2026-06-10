import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import Link from 'next/link';
import { formatPrice } from '@/lib/utils/format';
import { formatDate } from '@/lib/utils/format';
import type { Order, OrderStatus } from '@lepefy/types';

export const dynamic = 'force-dynamic';

// ─── SVG Flags ───────────────────────────────────────────────────────────────

const FLAGS: Record<string, string> = {
  FR: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="1" height="2" fill="#002395"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#ED2939"/></svg>`,
  BE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="1" height="2" fill="#000"/><rect x="1" width="1" height="2" fill="#FAE042"/><rect x="2" width="1" height="2" fill="#ED2939"/></svg>`,
  DE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 3"><rect width="5" height="3" fill="#FFCE00"/><rect width="5" height="2" fill="#000"/><rect width="5" height="1" fill="#DD0000"/></svg>`,
  CH: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#FF0000"/><rect x="13" y="6" width="6" height="20" fill="#fff"/><rect x="6" y="13" width="20" height="6" fill="#fff"/></svg>`,
  LU: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#EF3340"/><rect y="0.667" width="3" height="0.666" fill="#fff"/><rect y="1.333" width="3" height="0.667" fill="#00A3E0"/></svg>`,
  NL: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#AE1C28"/><rect y="0.667" width="3" height="0.666" fill="#fff"/><rect y="1.333" width="3" height="0.667" fill="#21468B"/></svg>`,
  ES: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#AA151B"/><rect y="0.5" width="3" height="1" fill="#F1BF00"/></svg>`,
  PT: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#FF0000"/><rect width="1.2" height="2" fill="#006600"/></svg>`,
};

function FlagBadge({ country }: { country: string }) {
  const svg = FLAGS[country.toUpperCase()];
  if (!svg) return <span className="text-xs text-gray-500">{country}</span>;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold"
      style={{ background: '#FEF3C7', color: '#92400E', border: '0.5px solid #FDE68A' }}
    >
      <span
        className="inline-block w-4 h-3 rounded-sm overflow-hidden"
        dangerouslySetInnerHTML={{ __html: svg }}
        style={{ lineHeight: 0 }}
      />
      {country.toUpperCase()}
    </span>
  );
}

// ─── Storage tag ─────────────────────────────────────────────────────────────

function StorageTag({ type }: { type: string | null }) {
  if (type === 'frozen') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-xs font-medium"
        style={{ background: '#EFF6FF', color: '#1D4ED8', border: '0.5px solid #BFDBFE' }}>
        ❄ surgelé
      </span>
    );
  }
  if (type === 'fresh') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-xs font-medium"
        style={{ background: '#F0FDF4', color: '#15803D', border: '0.5px solid #BBF7D0' }}>
        🌿 frais
      </span>
    );
  }
  return null;
}

// ─── Destination cell ────────────────────────────────────────────────────────

interface ShippingAddress {
  city?:        string;
  postal_code?: string;
  country?:     string;
}

function DestinationCell({
  fulfillmentType,
  shippingAddress,
}: {
  fulfillmentType: string;
  shippingAddress: ShippingAddress | null;
}) {
  if (fulfillmentType === 'pickup') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold"
        style={{ background: '#EFF6FF', color: '#1E40AF', border: '0.5px solid #BFDBFE' }}>
        🏪 C&amp;C
      </span>
    );
  }
  if (!shippingAddress) return <span className="text-gray-400 text-xs">—</span>;

  const country = shippingAddress.country ?? '';
  const isIT = country.toUpperCase() === 'IT' || country === '';

  if (isIT) {
    return (
      <span className="text-xs text-gray-500">
        {shippingAddress.postal_code && <span className="font-mono">{shippingAddress.postal_code}</span>}
        {shippingAddress.city && <span className="ml-1">{shippingAddress.city}</span>}
      </span>
    );
  }

  return <FlagBadge country={country} />;
}

// ─── Products cell ───────────────────────────────────────────────────────────

interface OrderItemRow {
  name:         string;
  quantity:     number;
  storage_type: string | null;
}

function ProductsCell({ items }: { items: OrderItemRow[] }) {
  const visible = items.slice(0, 3);
  const extra   = items.length - 3;

  return (
    <div className="space-y-0.5">
      {visible.map((item, i) => (
        <div key={i} className="flex items-center gap-1 text-xs text-gray-700">
          <span>{item.name} ×{item.quantity}</span>
          <StorageTag type={item.storage_type} />
        </div>
      ))}
      {extra > 0 && (
        <span className="text-xs text-gray-400">+ {extra} autre{extra > 1 ? 's' : ''}</span>
      )}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; color: string; border: string; label: string }> = {
  new:              { bg: '#F0F9FF', color: '#0369A1', border: '#BAE6FD', label: 'Nouveau' },
  preparing:        { bg: '#FFFBEB', color: '#B45309', border: '#FDE68A', label: 'En préparation' },
  ready_for_pickup: { bg: '#F0FDF4', color: '#15803D', border: '#BBF7D0', label: 'Prêt à retirer' },
  shipped:          { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE', label: 'Expédié' },
  delivered:        { bg: '#F0FDF4', color: '#166534', border: '#A7F3D0', label: 'Livré' },
  cancelled:        { bg: '#FEF2F2', color: '#B91C1C', border: '#FECACA', label: 'Annulé' },
};

function StatusBadge({ status }: { status: OrderStatus }) {
  const s = STATUS_STYLES[status] ?? { bg: '#F3F4F6', color: '#374151', border: '#D1D5DB', label: status };
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: s.bg, color: s.color, border: `0.5px solid ${s.border}` }}
    >
      {s.label}
    </span>
  );
}

// ─── In-store payment badge ───────────────────────────────────────────────────

function InStoreBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold"
      style={{ background: '#FEF3C7', color: '#92400E', border: '0.5px solid #FDE68A' }}
    >
      🏪 En boutique
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface OrderRow extends Order {
  order_items: OrderItemRow[];
}

export default async function AdminPage() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const supabase   = createServiceClient();

  const { data: orders } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(200) as { data: OrderRow[] | null };

  const rows = orders ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Commandes</h1>
            <p className="text-sm text-gray-500 mt-0.5">{rows.length} commande{rows.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">N°</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Produits</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((order) => {
                  const isInStorePending =
                    order.payment_method === 'in_store' && order.payment_status === 'pending';
                  const addr = order.shipping_address as ShippingAddress | null;

                  return (
                    <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                      {/* N° */}
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="font-mono text-xs font-semibold hover:underline"
                          style={{ color: 'var(--color-primary)' }}
                        >
                          {order.id.slice(0, 8).toUpperCase()}
                        </Link>
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {formatDate(order.created_at, 'fr')}
                      </td>

                      {/* Client + destination */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-gray-800 text-xs">
                            {order.full_name ?? order.email}
                          </span>
                          <span className="text-xs text-gray-400">{order.email}</span>
                          <DestinationCell
                            fulfillmentType={order.fulfillment_type}
                            shippingAddress={addr}
                          />
                        </div>
                      </td>

                      {/* Products */}
                      <td className="px-4 py-3 max-w-xs">
                        <ProductsCell items={order.order_items ?? []} />
                      </td>

                      {/* Total */}
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                        {formatPrice(order.total, tenant.currency)}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 items-start">
                          <StatusBadge status={order.status} />
                          {isInStorePending && <InStoreBadge />}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-400 text-sm">
                      Aucune commande pour l&apos;instant.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
