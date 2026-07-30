// Mappage statut DB → statut timeline, dupliqué depuis
// `(shop)/orders/[id]/page.tsx` (toTimelineStatus / STEPS) plutôt que
// ré-exporté — ce fichier de page est explicitement hors-scope (non modifiable)
// pour cette fonctionnalité. Toute évolution de la mappation doit être
// répercutée dans les deux fichiers.
export type TrackingStatus = 'confirmed' | 'preparing' | 'shipped' | 'delivered';

export function toTimelineStatus(dbStatus: string): TrackingStatus {
  const map: Record<string, TrackingStatus> = {
    new:              'confirmed',
    confirmed:        'confirmed',
    preparing:        'preparing',
    ready_for_pickup: 'preparing',
    shipped:          'shipped',
    delivered:        'delivered',
  };
  return map[dbStatus] ?? 'confirmed';
}

export const ORDER_STATUS_LABELS: Record<TrackingStatus, string> = {
  confirmed: 'Confirmé',
  preparing: 'En préparation',
  shipped:   'Expédié',
  delivered: 'Livré',
};

export const ORDER_STATUS_STEPS: TrackingStatus[] = ['confirmed', 'preparing', 'shipped', 'delivered'];

export function orderStatusStepIndex(status: TrackingStatus): number {
  return ORDER_STATUS_STEPS.indexOf(status);
}
