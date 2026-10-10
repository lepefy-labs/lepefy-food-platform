import type { AuditRow } from '@/lib/gestion/queries';
import { AUDIT_EVENT_LABELS, formatDateTime } from '@/lib/gestion/format';

const DETAIL_KEYS: [string, string][] = [
  ['reference', 'Réf.'], ['purchase', 'Achat'], ['payment', 'Paiement'], ['amount', 'Montant'],
  ['from', 'De'], ['to', 'Vers'], ['units', 'Unités'], ['delta', 'Quantité'], ['reason', 'Motif'],
];

/** Historique issu de business_audit_events (métadonnées déjà assainies en base). */
export function AuditTimeline({ events }: { events: AuditRow[] }) {
  if (!events.length) return <p className="text-sm text-a-text-3">Aucun événement enregistré.</p>;
  return (
    <ol className="space-y-3">
      {events.map((event) => {
        const details = DETAIL_KEYS
          .filter(([key]) => event.metadata[key] !== undefined && event.metadata[key] !== null && event.metadata[key] !== '')
          .map(([key, label]) => `${label} : ${String(event.metadata[key])}`);
        return (
          <li key={event.id} className="flex gap-3">
            <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-a-brand" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-a-text">{AUDIT_EVENT_LABELS[event.event_type] ?? event.event_type}</p>
              <p className="text-xs text-a-text-3">{formatDateTime(event.created_at)}{event.actor ? ` • ${event.actor}` : ''}</p>
              {details.length > 0 && <p className="mt-0.5 break-words text-xs text-a-text-2">{details.join(' • ')}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
