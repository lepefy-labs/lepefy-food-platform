/** Formattazione fr-FR per Gestion (pura, server e client). */

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

export function formatQuantity(value: number): string {
  return new Intl.NumberFormat('fr-FR').format(value);
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
