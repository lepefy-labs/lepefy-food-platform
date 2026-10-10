'use client';

import { useState } from 'react';
import { IconExternalLink, IconRoute } from '@tabler/icons-react';
import type { Order } from '@lepefy/types';
import { formatSince, transportState } from '@/lib/orders/adminOrderOperations';
import { safeShipmentTrackingUrl, shipmentDate, shipmentEventLabel, shipmentEventsNewestFirst } from '@/lib/shipping/shipmentPresentation';
import CopyableValue from '../../_components/ui/CopyableValue';

const VISIBLE_EVENTS = 4;

const TONES = {
  danger: 'bg-tone-danger-bg text-tone-danger-fg ring-tone-danger-border',
  success: 'bg-tone-success-bg text-tone-success-fg ring-tone-success-border',
  neutral: 'bg-a-surface-2 text-a-text-2 ring-a-border',
};

/**
 * Carrier-side view of a delivery, from persisted snapshots only (sync writes
 * them; this card never calls the provider). Kept apart from the order status.
 */
export default function ShipmentTrackingCard({ order, carrier, service, parcels, weight, nowIso }: {
  order: Order; carrier: string | null; service: string | null; parcels: number | null; weight: string | null; nowIso: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const now = new Date(nowIso);
  const events = shipmentEventsNewestFirst(order.shipping_tracking_events);
  const visible = showAll ? events : events.slice(0, VISIBLE_EVENTS);
  const transport = transportState(order);
  const trackingUrl = safeShipmentTrackingUrl(order.shipping_tracking_url);
  const eta = order.shipping_estimated_delivery_at && Number.isFinite(Date.parse(order.shipping_estimated_delivery_at))
    ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Rome' }).format(new Date(order.shipping_estimated_delivery_at)) : null;
  const meta = [carrier, service, parcels != null ? `${parcels} colis` : null, weight].filter(Boolean).join(' · ');

  return (
    <section id="order-tracking" aria-labelledby="order-tracking-title" className="scroll-mt-24 rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-tone-info-bg text-tone-info-fg"><IconRoute size={18} aria-hidden="true" /></span>
          <div>
            <h2 id="order-tracking-title" className="text-sm font-semibold text-a-text">Suivi transporteur</h2>
            {meta && <p className="text-xs text-a-text-3">{meta}</p>}
          </div>
        </div>
        {transport && <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[transport.tone]}`}>Transport : {transport.label}</span>}
      </div>

      <div className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
        {order.shipping_provider_reference && <CopyableValue label="Réf." value={order.shipping_provider_reference} />}
        {order.tracking_code && order.tracking_code !== order.shipping_provider_reference && <CopyableValue label="Suivi" value={order.tracking_code} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-a-text-3">
        <p>
          {[order.shipping_provider_synced_at && `Synchro ${formatSince(order.shipping_provider_synced_at, now)}`,
            events[0] && `dernier mouvement ${formatSince(events[0].occurredAt, now)}`,
            eta && `livraison estimée : ${eta}`].filter(Boolean).join(' · ') || 'Aucune donnée transporteur synchronisée pour le moment.'}
        </p>
        {trackingUrl && <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 font-semibold text-a-brand-fg hover:underline">Suivi transporteur <IconExternalLink size={13} aria-hidden="true" /><span className="sr-only"> (nouvel onglet)</span></a>}
      </div>

      {events.length > 0 && (
        <div className="mt-3 border-t border-a-border pt-3">
          <ol className="space-y-2" aria-label="Historique du suivi transporteur">
            {visible.map((event, index) => (
              <li key={`${event.occurredAt}-${index}`} className="flex items-start justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-start gap-2">
                  <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-full ${index === 0 ? (['exception', 'returned', 'cancelled'].includes(event.status) ? 'bg-tone-danger-solid' : 'bg-a-brand') : 'bg-a-border-strong'}`} />
                  <span className={index === 0 ? 'font-semibold text-a-text' : 'text-a-text-2'}>{shipmentEventLabel(event)}</span>
                </span>
                <time dateTime={event.occurredAt} className="shrink-0 text-a-text-3">{shipmentDate(event.occurredAt)}</time>
              </li>
            ))}
          </ol>
          {events.length > VISIBLE_EVENTS && (
            <button type="button" onClick={() => setShowAll(value => !value)} aria-expanded={showAll}
              className="mt-2 min-h-9 text-xs font-semibold text-a-brand-fg hover:underline focus-visible:outline-2 focus-visible:outline-a-focus">
              {showAll ? 'Afficher moins' : `Afficher tout (${events.length - VISIBLE_EVENTS} de plus)`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
