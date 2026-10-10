import { ORDER_STATUS_META, PAYMENT_STATUS_META, statusMeta } from '@/lib/admin/statusRegistry';
import { carrierDisplayName } from '@/lib/shipping/shipmentPresentation';

/** Rows above this are not exported (one request, Vercel 60 s budget). */
export const ORDER_EXPORT_LIMIT = 2000;

export interface ExportOrderRow {
  id: string;
  created_at: string;
  full_name: string | null;
  email: string | null;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_address: { city?: string; postal_code?: string; country?: string } | null;
  shipping_details: { carrierName?: string } | null;
  subtotal: number | null;
  shipping_cost: number | null;
  total: number | null;
  status: string;
  payment_method: string | null;
  payment_status: string | null;
  tracking_carrier: string | null;
  tracking_code: string | null;
  order_items: { quantity: number }[] | null;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  stripe: 'Carte bancaire', external_link: 'Lien de paiement', satispay: 'Satispay', in_store: 'En magasin', cash: 'Espèces', manual: 'Manuel',
};

function cell(value: unknown): string {
  const text = String(value ?? '');
  // Neutralise spreadsheet formulas in user-provided text (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Amounts with a comma decimal so French Excel reads them as numbers. */
function amount(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? '' : Number(value).toFixed(2).replace('.', ',');
}

function localDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).format(date).replace(',', '');
}

export const ORDER_CSV_HEADER = [
  'Commande', 'Date', 'Client', 'E-mail', 'Mode', 'Code postal', 'Ville', 'Pays', 'Articles',
  'Sous-total', 'Livraison', 'Total', 'Statut', 'Paiement', 'Statut du paiement', 'Transporteur', 'Suivi', 'ID',
];

/** UTF-8 CSV with BOM, `;` separator (French Excel), CRLF line ends. */
export function buildOrdersCsv(rows: ExportOrderRow[]): string {
  const lines = rows.map((order) => [
    `#${order.id.slice(0, 8).toUpperCase()}`,
    localDateTime(order.created_at),
    order.full_name ?? '',
    order.email ?? '',
    order.fulfillment_type === 'pickup' ? 'Retrait' : 'Livraison',
    order.shipping_address?.postal_code ?? '',
    order.shipping_address?.city ?? '',
    order.shipping_address?.country ?? '',
    (order.order_items ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
    amount(order.subtotal),
    amount(order.shipping_cost),
    amount(order.total),
    statusMeta(ORDER_STATUS_META, order.status).label,
    PAYMENT_METHOD_LABELS[order.payment_method ?? ''] ?? order.payment_method ?? '',
    statusMeta(PAYMENT_STATUS_META, order.payment_status).label,
    carrierDisplayName(order.tracking_carrier ?? order.shipping_details?.carrierName) ?? '',
    order.tracking_code ?? '',
    order.id,
  ].map(cell).join(';'));
  return `﻿${[ORDER_CSV_HEADER.map(cell).join(';'), ...lines].join('\r\n')}\r\n`;
}
