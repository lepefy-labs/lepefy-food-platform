'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { formatPrice } from '@/lib/utils/format';
import { formatDate } from '@/lib/utils/format';
import type { OrderStatus } from '@lepefy/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShippingAddress {
  city?:        string;
  postal_code?: string;
  country?:     string;
}

interface OrderItemRow {
  id:           string;
  name:         string;
  quantity:     number;
  subtotal:     number;
  storage_type: string | null;
}

interface OrderRow {
  id:               string;
  created_at:       string;
  full_name:        string | null;
  email:            string;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_address: ShippingAddress | null;
  subtotal:         number;
  shipping_cost:    number;
  total:            number;
  payment_method:   string | null;
  payment_status:   string;
  status:           OrderStatus;
  order_items:      OrderItemRow[];
}

interface Props {
  orders:   OrderRow[];
  currency: string;
}

// ─── Translations ─────────────────────────────────────────────────────────────

const translations = {
  fr: {
    orders:          'Commandes',
    totalOrders:     'Commandes totales',
    revenue:         "Chiffre d'affaires",
    toShip:          'À expédier',
    shippedMonth:    'Expédiées ce mois',
    allStatuses:     'Tous les statuts',
    allTypes:        'Tous les types',
    allPeriods:      'Toutes les dates',
    allPayments:     'Tous',
    today:           "Aujourd'hui",
    thisWeek:        'Cette semaine',
    thisMonth:       'Ce mois',
    delivery:        'Livraison',
    clickCollect:    'Click & Collect',
    pending:         'En attente',
    paidOnline:      'Payé en ligne',
    paidInStore:     'Paiement en boutique',
    allDest:         'Toutes destinations',
    italy:           'Italie',
    international:   'International',
    allStorage:      'Tous produits',
    frozen:          'Contient surgelés',
    fresh:           'Contient frais',
    moreFilters:     'Plus de filtres',
    resetFilters:    'Réinitialiser',
    noOrders:        'Aucune commande pour ce filtre.',
    // status labels
    new:             'Nouveau',
    preparing:       'En préparation',
    readyPickup:     'Prêt à retirer',
    shipped:         'Expédié',
    delivered:       'Livré',
    cancelled:       'Annulé',
    // table headers
    colNum:          'N°',
    colDate:         'Date',
    colClient:       'Client',
    colProducts:     'Produits',
    colTotal:        'Total',
    colStatus:       'Statut',
    // destination
    destLabel:       'Destination',
    storageLabel:    'Conservation',
  },
  it: {
    orders:          'Ordini',
    totalOrders:     'Ordini totali',
    revenue:         'Fatturato',
    toShip:          'Da spedire',
    shippedMonth:    'Spediti questo mese',
    allStatuses:     'Tutti gli stati',
    allTypes:        'Tutti i tipi',
    allPeriods:      'Tutte le date',
    allPayments:     'Tutti',
    today:           'Oggi',
    thisWeek:        'Questa settimana',
    thisMonth:       'Questo mese',
    delivery:        'Consegna',
    clickCollect:    'Click & Collect',
    pending:         'In attesa',
    paidOnline:      'Pagato online',
    paidInStore:     'Pagamento in negozio',
    allDest:         'Tutte le destinazioni',
    italy:           'Italia',
    international:   'Internazionale',
    allStorage:      'Tutti i prodotti',
    frozen:          'Contiene surgelati',
    fresh:           'Contiene freschi',
    moreFilters:     'Altri filtri',
    resetFilters:    'Azzera filtri',
    noOrders:        'Nessun ordine per questo filtro.',
    new:             'Nuovo',
    preparing:       'In preparazione',
    readyPickup:     'Pronto per ritiro',
    shipped:         'Spedito',
    delivered:       'Consegnato',
    cancelled:       'Annullato',
    colNum:          'N°',
    colDate:         'Data',
    colClient:       'Cliente',
    colProducts:     'Prodotti',
    colTotal:        'Totale',
    colStatus:       'Stato',
    destLabel:       'Destinazione',
    storageLabel:    'Conservazione',
  },
} as const;

type Lang         = keyof typeof translations;
type Translations = typeof translations.fr | typeof translations.it;

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

// ─── Products cell ───────────────────────────────────────────────────────────

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

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  new:              { bg: '#F0F9FF', color: '#0369A1', border: '#BAE6FD' },
  preparing:        { bg: '#FFFBEB', color: '#B45309', border: '#FDE68A' },
  ready_for_pickup: { bg: '#F0FDF4', color: '#15803D', border: '#BBF7D0' },
  shipped:          { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
  delivered:        { bg: '#F0FDF4', color: '#166534', border: '#A7F3D0' },
  cancelled:        { bg: '#FEF2F2', color: '#B91C1C', border: '#FECACA' },
};

function statusLabel(status: OrderStatus, t: Translations): string {
  const map: Record<string, string> = {
    new:              t.new,
    preparing:        t.preparing,
    ready_for_pickup: t.readyPickup,
    shipped:          t.shipped,
    delivered:        t.delivered,
    cancelled:        t.cancelled,
  };
  return map[status] ?? status;
}

function StatusBadge({ status, t }: { status: OrderStatus; t: Translations }) {
  const s = STATUS_STYLE[status] ?? { bg: '#F3F4F6', color: '#374151', border: '#D1D5DB' };
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: s.bg, color: s.color, border: `0.5px solid ${s.border}` }}
    >
      {statusLabel(status, t)}
    </span>
  );
}

// ─── In-store badge ───────────────────────────────────────────────────────────

function InStoreBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold"
      style={{ background: '#FEF3C7', color: '#92400E', border: '0.5px solid #FDE68A' }}
    >
      🏪 {label}
    </span>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Filter select ────────────────────────────────────────────────────────────

function FilterSelect({
  value,
  onChange,
  options,
  active,
}: {
  value:    string;
  onChange: (v: string) => void;
  options:  { value: string; label: string }[];
  active:   boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs font-medium px-2.5 py-1.5 rounded-lg border cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-colors"
      style={
        active
          ? {
              borderColor: 'var(--color-primary)',
              color:       'var(--color-primary)',
              background:  'var(--color-primary-light, #f0fdf4)',
            }
          : {
              borderColor: '#E5E7EB',
              color:       '#4B5563',
              background:  '#fff',
            }
      }
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ─── Filter state ─────────────────────────────────────────────────────────────

interface Filters {
  status:      string;
  type:        string;
  period:      string;
  payment:     string;
  destination: string;
  storage:     string;
}

const DEFAULT_FILTERS: Filters = {
  status:      'all',
  type:        'all',
  period:      'all',
  payment:     'all',
  destination: 'all',
  storage:     'all',
};

function isActiveFilter(filters: Filters): boolean {
  return Object.values(filters).some((v) => v !== 'all');
}

function applyFilters(orders: OrderRow[], filters: Filters): OrderRow[] {
  return orders.filter((order) => {
    // status
    if (filters.status !== 'all' && order.status !== filters.status) return false;

    // type
    if (filters.type !== 'all' && order.fulfillment_type !== filters.type) return false;

    // period
    if (filters.period !== 'all') {
      const created = new Date(order.created_at);
      const now     = new Date();
      if (filters.period === 'today') {
        if (created.toDateString() !== now.toDateString()) return false;
      } else if (filters.period === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        if (created < weekAgo) return false;
      } else if (filters.period === 'month') {
        if (
          created.getMonth()     !== now.getMonth() ||
          created.getFullYear()  !== now.getFullYear()
        ) return false;
      }
    }

    // payment
    if (filters.payment !== 'all') {
      if (filters.payment === 'pending' && order.payment_status !== 'pending')
        return false;
      if (
        filters.payment === 'online' &&
        !['stripe', 'satispay'].includes(order.payment_method ?? '')
      ) return false;
      if (filters.payment === 'in_store' && order.payment_method !== 'in_store')
        return false;
    }

    // destination
    if (filters.destination !== 'all') {
      if (order.fulfillment_type === 'pickup') {
        if (filters.destination === 'international') return false;
      } else {
        const country = (order.shipping_address?.country ?? 'IT').toUpperCase();
        if (filters.destination === 'italy'         && country !== 'IT') return false;
        if (filters.destination === 'international' && country === 'IT') return false;
      }
    }

    // storage
    if (filters.storage !== 'all') {
      const items = order.order_items ?? [];
      if (filters.storage === 'frozen' && !items.some((i) => i.storage_type === 'frozen'))
        return false;
      if (filters.storage === 'fresh' && !items.some((i) => i.storage_type === 'fresh' || i.storage_type === 'frozen'))
        return false;
    }

    return true;
  });
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminOrdersClient({ orders, currency }: Props) {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('lepefy-admin-lang') as Lang) ?? 'fr';
    }
    return 'fr';
  });

  const [filters, setFilters]     = useState<Filters>(DEFAULT_FILTERS);
  const [showMore,  setShowMore]  = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const t = translations[lang];

  function switchLang(l: Lang) {
    setLang(l);
    localStorage.setItem('lepefy-admin-lang', l);
  }

  function setFilter(key: keyof Filters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  // Close "plus de filtres" on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setShowMore(false);
      }
    }
    if (showMore) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMore]);

  const filtered    = applyFilters(orders, filters);
  const hasActive   = isActiveFilter(filters);

  // ── KPI (always global, not filtered) ─────────────────────────────────────
  const now          = new Date();
  const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
  const toShip       = orders.filter(
    (o) => o.status === 'preparing' || o.status === 'ready_for_pickup'
  ).length;
  const shippedMonth = orders.filter((o) => {
    const d = new Date(o.created_at);
    return (
      (o.status === 'shipped' || o.status === 'delivered') &&
      d.getMonth()    === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    );
  }).length;

  // ── Filter option lists ────────────────────────────────────────────────────
  const statusOptions = [
    { value: 'all',              label: t.allStatuses },
    { value: 'preparing',        label: t.preparing   },
    { value: 'ready_for_pickup', label: t.readyPickup },
    { value: 'shipped',          label: t.shipped     },
    { value: 'delivered',        label: t.delivered   },
    { value: 'cancelled',        label: t.cancelled   },
  ];

  const typeOptions = [
    { value: 'all',      label: t.allTypes    },
    { value: 'delivery', label: t.delivery    },
    { value: 'pickup',   label: t.clickCollect },
  ];

  const periodOptions = [
    { value: 'all',   label: t.allPeriods },
    { value: 'today', label: t.today      },
    { value: 'week',  label: t.thisWeek   },
    { value: 'month', label: t.thisMonth  },
  ];

  const paymentOptions = [
    { value: 'all',      label: t.allPayments  },
    { value: 'pending',  label: t.pending      },
    { value: 'online',   label: t.paidOnline   },
    { value: 'in_store', label: t.paidInStore  },
  ];

  const destOptions = [
    { value: 'all',           label: t.allDest      },
    { value: 'italy',         label: t.italy        },
    { value: 'international', label: t.international },
  ];

  const storageOptions = [
    { value: 'all',    label: t.allStorage },
    { value: 'frozen', label: t.frozen     },
    { value: 'fresh',  label: t.fresh      },
  ];

  const extraActive =
    filters.destination !== 'all' || filters.storage !== 'all';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t.orders}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {filtered.length === orders.length
                ? `${orders.length} commande${orders.length !== 1 ? 's' : ''}`
                : `${filtered.length} / ${orders.length} commande${orders.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          {/* Lang toggle */}
          <div className="flex gap-1">
            {(['fr', 'it'] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => switchLang(l)}
                className={`text-xs px-2 py-1 rounded font-medium border transition-colors ${
                  lang === l
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary-light,#f0fdf4)]'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* ── KPI cards ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <KpiCard
            label={t.totalOrders}
            value={String(orders.length)}
          />
          <KpiCard
            label={t.revenue}
            value={formatPrice(totalRevenue, currency)}
          />
          <KpiCard
            label={t.toShip}
            value={String(toShip)}
          />
          <KpiCard
            label={t.shippedMonth}
            value={String(shippedMonth)}
          />
        </div>

        {/* ── Filter bar ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              value={filters.status}
              onChange={(v) => setFilter('status', v)}
              options={statusOptions}
              active={filters.status !== 'all'}
            />
            <FilterSelect
              value={filters.type}
              onChange={(v) => setFilter('type', v)}
              options={typeOptions}
              active={filters.type !== 'all'}
            />
            <FilterSelect
              value={filters.period}
              onChange={(v) => setFilter('period', v)}
              options={periodOptions}
              active={filters.period !== 'all'}
            />
            <FilterSelect
              value={filters.payment}
              onChange={(v) => setFilter('payment', v)}
              options={paymentOptions}
              active={filters.payment !== 'all'}
            />

            {/* More filters */}
            <div className="relative" ref={moreRef}>
              <button
                onClick={() => setShowMore((s) => !s)}
                className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors focus:outline-none ${
                  extraActive || showMore
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary-light,#f0fdf4)]'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {t.moreFilters} {extraActive ? '●' : '▾'}
              </button>

              {showMore && (
                <div
                  className="absolute left-0 top-full mt-1.5 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-3 min-w-[220px] space-y-3"
                >
                  <div>
                    <p className="text-xs text-gray-400 font-medium mb-1.5">{t.destLabel}</p>
                    <FilterSelect
                      value={filters.destination}
                      onChange={(v) => setFilter('destination', v)}
                      options={destOptions}
                      active={filters.destination !== 'all'}
                    />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium mb-1.5">{t.storageLabel}</p>
                    <FilterSelect
                      value={filters.storage}
                      onChange={(v) => setFilter('storage', v)}
                      options={storageOptions}
                      active={filters.storage !== 'all'}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Reset */}
            {hasActive && (
              <button
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors ml-auto"
              >
                ✕ {t.resetFilters}
              </button>
            )}
          </div>
        </div>

        {/* ── Table ──────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t.colNum}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t.colDate}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t.colClient}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t.colProducts}
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t.colTotal}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t.colStatus}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((order) => {
                  const isInStorePending =
                    order.payment_method === 'in_store' &&
                    order.payment_status  === 'pending';
                  const addr = order.shipping_address;

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
                        {formatDate(order.created_at, lang === 'it' ? 'it' : 'fr')}
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
                        {formatPrice(order.total, currency)}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 items-start">
                          <StatusBadge status={order.status} t={t} />
                          {isInStorePending && (
                            <InStoreBadge label={t.paidInStore} />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-400 text-sm">
                      {t.noOrders}
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
