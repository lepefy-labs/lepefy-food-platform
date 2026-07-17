'use client';

import { useState, Fragment } from 'react';
import Link from 'next/link';
import {
  IconSearch,
  IconX,
  IconChevronDown,
  IconChevronRight,
  IconPrinter,
} from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import StatusBadge from '../_components/ui/StatusBadge';
import type { OrderStatus } from '@lepefy/types';

// ─── Local types ──────────────────────────────────────────────────────────────

interface ShippingAddress {
  city?:        string;
  postal_code?: string;
  country?:     string;
}

interface ShippingDetails {
  carrierName?: string;
  numParcels?:  number;
}

export interface OrderItemRow {
  id:           string;
  name:         string;
  quantity:     number;
  subtotal:     number;
  storage_type: string | null;
}

export interface ListOrder {
  id:               string;
  created_at:       string;
  full_name:        string | null;
  email:            string;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_address: ShippingAddress | null;
  shipping_details: ShippingDetails | null;
  subtotal:         number;
  shipping_cost:    number;
  total:            number;
  payment_method:   string | null;
  payment_status:   string;
  status:           OrderStatus;
  order_items:      OrderItemRow[];
}

// ─── SVG Flags ────────────────────────────────────────────────────────────────

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

// ─── DestinationCell ──────────────────────────────────────────────────────────

function DestinationCell({
  fulfillmentType,
  shippingAddress,
}: {
  fulfillmentType: string;
  shippingAddress: ShippingAddress | null;
}) {
  if (fulfillmentType === 'pickup') {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold"
        style={{ background: '#EFF6FF', color: '#1E40AF', border: '0.5px solid #BFDBFE' }}
      >
        🏪 C&amp;C
      </span>
    );
  }
  if (!shippingAddress) return <span className="text-gray-400 text-xs">—</span>;

  const country = shippingAddress.country ?? '';
  const isIT    = country.toUpperCase() === 'IT' || country === '';

  if (isIT) {
    return (
      <span className="text-xs text-gray-500">
        {shippingAddress.postal_code && (
          <span className="font-mono">{shippingAddress.postal_code}</span>
        )}
        {shippingAddress.city && <span className="ml-1">{shippingAddress.city}</span>}
      </span>
    );
  }

  return <FlagBadge country={country} />;
}

// ─── PaymentBadge ─────────────────────────────────────────────────────────────

const PAYMENT_CONFIG: Record<string, { label: string; icon: string; bg: string; color: string }> = {
  stripe: {
    label: 'Carte',
    icon:  '💳',
    bg:    '#F3F4F6',
    color: '#374151',
  },
  satispay: {
    label: 'Satispay',
    icon:  '🟠',
    bg:    '#FFF7ED',
    color: '#C2410C',
  },
  in_store: {
    label: 'En magasin',
    icon:  '🏪',
    bg:    '#EFF6FF',
    color: '#1D4ED8',
  },
  cash: {
    label: 'Espèces',
    icon:  '💶',
    bg:    '#F0FDF4',
    color: '#15803D',
  },
};

function PaymentBadge({ method }: { method: string | null }) {
  if (!method) return <span className="text-gray-400 text-xs">—</span>;

  const cfg = PAYMENT_CONFIG[method] ?? { label: method, icon: '💶', bg: '#F3F4F6', color: '#374151' };

  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      <span>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

// ─── OrdersTable ──────────────────────────────────────────────────────────────

interface OrdersTableProps {
  orders:         ListOrder[];
  tenantCurrency: string;
}

export default function OrdersTable({ orders, tenantCurrency }: OrdersTableProps) {
  const [searchQuery, setSearchQuery]   = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  function toggleRow(orderId: string) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  }

  const filteredOrders = searchQuery.trim()
    ? orders.filter(o => {
        const q = searchQuery.toLowerCase();
        return (
          (o.full_name ?? '').toLowerCase().includes(q) ||
          (o.email     ?? '').toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q)                ||
          o.id.slice(0, 8).toLowerCase().includes(q)
        );
      })
    : orders;

  return (
    <div>

      {/* ── Search bar + contatore ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <IconSearch
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Client, email ou n° commande..."
            className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200
                       rounded-lg bg-white focus:outline-none
                       focus:ring-2 focus:ring-[var(--color-primary)]
                       focus:border-transparent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2
                         p-1.5 -m-1.5 text-gray-400 hover:text-gray-600"
              aria-label="Effacer"
            >
              <IconX size={13} />
            </button>
          )}
        </div>

        {searchQuery && (
          <span className="text-xs text-gray-500 flex-shrink-0">
            {filteredOrders.length} résultat
            {filteredOrders.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Tabella ─────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {filteredOrders.length === 0 ? (
          <p className="text-center text-gray-500 text-sm py-12">
            {searchQuery
              ? `Aucune commande pour « ${searchQuery} »`
              : 'Aucune commande.'
            }
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs
                               font-semibold text-gray-500 uppercase tracking-wide">
                  <th scope="col" className="w-8 px-3 py-3">
                    <span className="sr-only">Développer</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">Commande</th>
                  <th scope="col" className="px-4 py-3 text-left">Client</th>
                  <th scope="col" className="px-4 py-3 text-left">Produits</th>
                  <th scope="col" className="px-4 py-3 text-left">Destination</th>
                  <th scope="col" className="px-4 py-3 text-left">Montant</th>
                  <th scope="col" className="px-4 py-3 text-left">Statut</th>
                  <th scope="col" className="px-4 py-3 text-left">Paiement</th>
                  <th scope="col" className="px-4 py-3 text-left">Transporteur</th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map(order => {
                  const isExpanded   = expandedRows.has(order.id);
                  const items        = order.order_items ?? [];
                  const visibleItems = items.slice(0, 2);
                  const hiddenCount  = Math.max(0, items.length - 2);
                  const isToday      = new Date(order.created_at).toDateString() === new Date().toDateString();

                  return (
                    <Fragment key={order.id}>

                      {/* ── Riga principale ──────────────────────────────── */}
                      <tr className={`border-b border-gray-50 hover:bg-gray-50 transition-colors${isExpanded ? ' bg-gray-50/60' : ''}`}>

                        {/* Freccia espansione */}
                        <td className="px-3 py-3 w-8">
                          {items.length > 0 && (
                            <button
                              onClick={() => toggleRow(order.id)}
                              className="p-2 rounded text-gray-400
                                         hover:text-gray-600
                                         hover:bg-gray-200 transition-colors"
                              aria-label={isExpanded ? 'Réduire' : 'Développer'}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded
                                ? <IconChevronDown size={14} stroke={2} />
                                : <IconChevronRight size={14} stroke={1.5} />
                              }
                            </button>
                          )}
                        </td>

                        {/* Commande */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="font-mono text-xs font-medium text-gray-700">
                            #{order.id.slice(0, 8).toUpperCase()}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {new Date(order.created_at).toLocaleDateString('fr-FR', {
                              day: '2-digit', month: '2-digit',
                            })}
                          </p>
                          {isToday && (
                            <span className="text-xs font-medium bg-yellow-50 text-yellow-700
                                             px-1.5 py-0.5 rounded mt-0.5 inline-block">
                              Aujourd&apos;hui
                            </span>
                          )}
                        </td>

                        {/* Client */}
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-gray-900 leading-snug">
                            {order.full_name ?? '—'}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[160px]">
                            {order.email}
                          </p>
                        </td>

                        {/* Produits — max 2 + contatore */}
                        <td className="px-4 py-3 max-w-[200px]">
                          <div className="space-y-1">
                            {visibleItems.map((item, idx) => (
                              <div key={item.id ?? idx} className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-gray-500
                                                 bg-gray-100 rounded px-1.5 py-0.5 flex-shrink-0">
                                  ×{item.quantity}
                                </span>
                                <span className="text-xs text-gray-700 truncate">
                                  {item.name}
                                </span>
                                {item.storage_type === 'frozen' && (
                                  <span className="text-[10px]" title="Surgelé" aria-label="Surgelé" role="img">❄</span>
                                )}
                                {item.storage_type === 'fresh' && (
                                  <span className="text-[10px]" title="Frais" aria-label="Frais" role="img">🌿</span>
                                )}
                              </div>
                            ))}
                            {hiddenCount > 0 && !isExpanded && (
                              <p className="text-xs text-gray-500 mt-0.5">
                                + {hiddenCount} autre{hiddenCount > 1 ? 's' : ''}{' '}
                                <span className="text-gray-500">(↑ développer)</span>
                              </p>
                            )}
                          </div>
                        </td>

                        {/* Destination */}
                        <td className="px-4 py-3">
                          <DestinationCell
                            fulfillmentType={order.fulfillment_type}
                            shippingAddress={order.shipping_address}
                          />
                        </td>

                        {/* Montant */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-semibold text-gray-900">
                            {formatPrice(order.total, tenantCurrency)}
                          </span>
                        </td>

                        {/* Statut */}
                        <td className="px-4 py-3">
                          <StatusBadge status={order.status} />
                        </td>

                        {/* Paiement */}
                        <td className="px-4 py-3">
                          <PaymentBadge method={order.payment_method} />
                        </td>

                        {/* Transporteur */}
                        <td className="px-4 py-3">
                          <span className="text-xs text-gray-500">
                            {order.shipping_details?.carrierName ?? '—'}
                          </span>
                          {order.shipping_details?.numParcels != null &&
                           order.shipping_details.numParcels > 1 && (
                            <span className="text-xs text-gray-500 block mt-0.5">
                              {order.shipping_details.numParcels} colis
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/admin/orders/${order.id}/picking-list`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 text-gray-400 hover:text-gray-600
                                         hover:bg-gray-100 rounded transition-colors"
                              title="Liste de préparation"
                              aria-label="Imprimer la liste de préparation"
                            >
                              <IconPrinter size={15} />
                            </Link>
                            <Link
                              href={`/admin/orders/${order.id}`}
                              className="text-xs font-medium px-3 py-1.5 rounded-lg
                                         border border-gray-200 hover:bg-gray-50
                                         transition-colors whitespace-nowrap"
                            >
                              Voir →
                            </Link>
                          </div>
                        </td>
                      </tr>

                      {/* ── Pannello espanso ─────────────────────────────── */}
                      {isExpanded && (
                        <tr key={`${order.id}-detail`}>
                          <td />
                          <td colSpan={9} className="px-4 pb-4 pt-1">
                            <div className="bg-white rounded-lg border border-gray-100
                                            overflow-hidden shadow-sm">

                              <div className="px-4 py-2 border-b border-gray-100
                                              bg-gray-50 flex items-center justify-between">
                                <span className="text-xs font-medium text-gray-500
                                                 uppercase tracking-wide">
                                  Détail de la commande
                                </span>
                                <span className="text-xs text-gray-500">
                                  {items.length} article{items.length > 1 ? 's' : ''}
                                </span>
                              </div>

                              <div className="divide-y divide-gray-50">
                                {items.map((item, idx) => (
                                  <div
                                    key={item.id ?? idx}
                                    className="flex items-center justify-between px-4 py-2.5"
                                  >
                                    <div className="flex items-center gap-3">
                                      <span className="text-xs font-semibold
                                                       text-[var(--color-primary)]
                                                       bg-[var(--color-primary-light)]
                                                       rounded px-2 py-0.5 flex-shrink-0">
                                        ×{item.quantity}
                                      </span>
                                      <span className="text-sm text-gray-800">{item.name}</span>
                                      {item.storage_type === 'frozen' && (
                                        <span className="text-xs" title="Surgelé" aria-label="Surgelé" role="img">❄</span>
                                      )}
                                      {item.storage_type === 'fresh' && (
                                        <span className="text-xs" title="Frais" aria-label="Frais" role="img">🌿</span>
                                      )}
                                    </div>
                                    <span className="text-sm font-medium text-gray-600
                                                     flex-shrink-0 ml-4">
                                      {formatPrice(item.subtotal, tenantCurrency)}
                                    </span>
                                  </div>
                                ))}
                              </div>

                              <div className="px-4 py-2.5 border-t border-gray-100
                                              bg-gray-50 flex justify-between items-center">
                                <span className="text-xs text-gray-500">Total commande</span>
                                <span className="text-sm font-bold text-gray-900">
                                  {formatPrice(order.total, tenantCurrency)}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                    </Fragment>
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
