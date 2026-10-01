/** Formattazione fr-FR per Gestion (pura, server e client). */

import { PURCHASE_UNIT_LABELS, type PurchaseUnit } from '@/lib/gestion/domain';

export function formatMoney(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '-'
    : date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Quantité fr-FR : 12 / 12,5 / 12,75 / 12,375 (jamais 12,000). */
export function formatQuantity(value: number | string): string {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(Number.isFinite(numeric) ? numeric : 0);
}

const PLURAL_UNITS: Partial<Record<PurchaseUnit, string>> = { unit: 'unités', pack: 'packs', box: 'boîtes', carton: 'cartons' };

/** Quantité avec son unité d'achat : « 12,5 kg », « 3 cartons », « 1 unité ». */
export function formatQuantityWithUnit(value: number | string, unit: PurchaseUnit = 'unit'): string {
  const numeric = typeof value === 'string' ? Number(value) : value;
  const label = numeric > 1 && PLURAL_UNITS[unit] ? PLURAL_UNITS[unit] : PURCHASE_UNIT_LABELS[unit];
  return `${formatQuantity(numeric)} ${label}`;
}

/** Unités de stock vendables : « 25 unités ». */
export function formatStockUnits(value: number): string {
  return `${formatQuantity(value)} unité${Math.abs(value) > 1 ? 's' : ''}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

export const AUDIT_EVENT_LABELS: Record<string, string> = {
  'supplier.created': 'Fournisseur créé',
  'supplier.updated': 'Fournisseur modifié',
  'purchase.created': 'Achat créé',
  'purchase.updated': 'Achat modifié',
  'purchase.status_changed': 'Statut de l\'achat modifié',
  'receipt.recorded': 'Réception enregistrée',
  'receipt.reversed': 'Réception annulée',
  'inventory.adjusted': 'Stock ajusté',
  'payment.recorded': 'Paiement enregistré',
  'payment.verified': 'Paiement vérifié',
  'payment.voided': 'Paiement annulé',
  'allocation.created': 'Paiement affecté',
  'allocation.reversed': 'Affectation retirée',
  'document.uploaded': 'Document ajouté',
  'document.deleted': 'Document supprimé',
};

/** Data di oggi (YYYY-MM-DD) nel fuso locale del browser/server. */
export function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
