import type { NormalizedShipmentStatus, ShipmentTrackingEvent } from '@lepefy/types';
import { getCustomerOrderPresentation, type CustomerOrderStage, type FulfillmentKind } from '@/lib/orders/orderStatus';
import {
  carrierDisplayName, carrierTrackingLink, shipmentDate, shipmentEventLabel, shipmentEventsNewestFirst,
} from '@/lib/shipping/shipmentPresentation';

/**
 * Customer tracking page (/orders/[id]?token=), « Essentiel » layout: one pure
 * view model from the stored order only (no provider call, nothing invented).
 * The order status (what the shop did) and the carrier status (what the
 * carrier reported, managed tracking only) stay separate: the headline uses
 * the carrier only once the order is shipped, and never says more than the
 * carrier said (« en transit » is never « livré aujourd'hui »).
 */

export interface TrackingOrderInput {
  id: string;
  status: string;
  fulfillment_type: FulfillmentKind;
  created_at: string;
  updated_at: string;
  shipped_at?: string | null;
  picking_started_at?: string | null;
  tracking_code?: string | null;
  tracking_carrier?: string | null;
  shipping_details?: { trackingCode?: string; trackingCarrier?: string; carrierName?: string } | null;
  shipping_tracking_mode?: 'managed' | 'manual' | null;
  shipping_provider_reference?: string | null;
  shipping_normalized_status?: NormalizedShipmentStatus | null;
  shipping_tracking_url?: string | null;
  shipping_estimated_delivery_at?: string | null;
  shipping_tracking_events?: ShipmentTrackingEvent[] | null;
}

export type TrackingTone = 'info' | 'progress' | 'success' | 'warning' | 'danger';

export interface TrackingFact { label: string; value: string; muted: boolean }

export interface TrackingStep { key: CustomerOrderStage; label: string; state: 'done' | 'current' | 'todo'; date: string | null }

export interface OrderTrackingView {
  ref: string;
  fulfillment: FulfillmentKind;
  cancelled: boolean;
  /** `kicker` says whose status it is: the carrier's or the order's. */
  hero: { tone: TrackingTone; kicker: string; title: string; detail: string };
  /** Mint date box: estimated day, delivery day, pickup; null when nothing applies (cancelled). */
  dateBox: TrackingFact | null;
  /** « Dernière mise à jour : 22 oct. 2026, 14:52 ». */
  updatedAt: string | null;
  alert: { title: string; text: string } | null;
  /** Delivery only. `null` = no shipment block (pickup, cancelled order). */
  shipment: {
    carrier: string;
    carrierKnown: boolean;
    code: string | null;
    url: string | null;
    actionLabel: string;
    caption: string;
    hint: string | null;
  } | null;
  /** Shown instead of the shipment block before the parcel leaves. */
  shipmentPending: string | null;
  steps: TrackingStep[];
  events: { label: string; date: string; latest: boolean }[] | null;
  eventsEmpty: string;
}

/** Packlink gives a date only: shown as a day, in the carrier's zone. */
const TRACKING_ZONE = 'Europe/Rome';

function validIso(value: string | null | undefined): value is string {
  return Boolean(value && Number.isFinite(Date.parse(value)));
}

function dayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TRACKING_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** « jeudi 23 octobre » (year added when it is not the current one). */
export function trackingDay(iso: string, now: Date): string {
  const sameYear = dayKey(iso).slice(0, 4) === dayKey(now.toISOString()).slice(0, 4);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }), timeZone: TRACKING_ZONE,
  }).format(new Date(iso));
}

function shortDay(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: TRACKING_ZONE }).format(new Date(iso));
}

function carrierHeadline(status: NormalizedShipmentStatus, carrier: string | null): { tone: TrackingTone; title: string; detail: string } | null {
  const by = carrier ?? 'le transporteur';
  const By = carrier ?? 'Le transporteur';
  switch (status) {
    case 'ready_for_collection': return { tone: 'progress', title: 'Votre colis attend le transporteur', detail: `Il est prêt et sera bientôt pris en charge par ${by}.` };
    case 'in_transit': return { tone: 'progress', title: 'Votre colis est en transit', detail: carrier ? `Il poursuit son trajet avec ${carrier}.` : 'Il poursuit son trajet vers votre adresse.' };
    case 'out_for_delivery': return { tone: 'progress', title: 'Votre colis est en cours de livraison', detail: `${By} indique qu’il est en tournée de livraison.` };
    case 'delivered': return { tone: 'success', title: 'Votre colis a été livré', detail: `${By} indique que le colis a été livré.` };
    case 'exception': return { tone: 'warning', title: 'Incident de livraison', detail: `${By} signale un problème sur la livraison de votre colis.` };
    case 'returned': return { tone: 'danger', title: 'Votre colis est retourné', detail: `${By} indique un retour du colis à l’expéditeur. Contactez-nous.` };
    case 'cancelled': return { tone: 'warning', title: 'Expédition interrompue', detail: `${By} indique que l’expédition a été annulée. Contactez-nous.` };
    default: return null;
  }
}

const STEP_LABELS: Record<FulfillmentKind, Record<string, string>> = {
  delivery: { confirmed: 'Confirmée', preparing: 'Préparée', shipped: 'Expédiée', delivered: 'Livrée' },
  pickup: { confirmed: 'Confirmée', preparing: 'Préparée', ready_for_pickup: 'Prête', delivered: 'Retirée' },
};

export function buildOrderTrackingView(order: TrackingOrderInput, now: Date): OrderTrackingView {
  const presentation = getCustomerOrderPresentation(order.status, order.fulfillment_type);
  const isPickup = order.fulfillment_type === 'pickup';
  const cancelled = presentation.stage === 'cancelled';
  const managed = order.shipping_tracking_mode === 'managed' && Boolean(order.shipping_provider_reference);
  const carrierStatus = managed ? order.shipping_normalized_status ?? null : null;
  const events = shipmentEventsNewestFirst(order.shipping_tracking_events);
  const sd = order.shipping_details ?? {};
  const code = (order.tracking_code ?? sd.trackingCode ?? '').trim() || null;
  const rawCarrier = order.tracking_carrier ?? sd.trackingCarrier ?? sd.carrierName ?? null;
  const carrier = carrierDisplayName(rawCarrier);
  const shippedStage = presentation.stage === 'shipped';
  const deliveredByOrder = presentation.stage === 'delivered';
  // The carrier may confirm delivery before the shop closes the order.
  const deliveredByCarrier = !isPickup && shippedStage && carrierStatus === 'delivered';
  const delivered = deliveredByOrder || deliveredByCarrier;
  const deliveredAt = events.find((event) => event.status === 'delivered')?.occurredAt ?? null;

  // ─── Headline ───────────────────────────────────────────────────────────────
  let hero: OrderTrackingView['hero'];
  const fromCarrier = !isPickup && shippedStage && carrierStatus ? carrierHeadline(carrierStatus, carrier) : null;
  const ORDER_KICKER = 'Statut de la commande';
  if (cancelled) {
    hero = { tone: 'danger', kicker: ORDER_KICKER, title: presentation.title, detail: presentation.description };
  } else if (fromCarrier) {
    hero = { ...fromCarrier, kicker: 'Statut transporteur' };
  } else if (deliveredByOrder) {
    hero = { tone: 'success', kicker: ORDER_KICKER, title: isPickup ? 'Commande retirée' : 'Votre colis a été livré', detail: presentation.description };
  } else if (shippedStage) {
    hero = {
      tone: 'progress', kicker: ORDER_KICKER, title: 'Votre commande est expédiée',
      // Only point to the carrier site when there is something to follow (a code).
      detail: `Le colis a été remis ${carrier ? `à ${carrier}` : 'au transporteur'}.${managed
        ? ' Ses prochaines étapes s’afficheront ici dès qu’il les communiquera.'
        : code ? ' Suivez son avancement sur le site du transporteur.' : ''}`,
    };
  } else {
    hero = { tone: presentation.stage === 'ready_for_pickup' ? 'success' : 'info', kicker: ORDER_KICKER, title: presentation.title, detail: presentation.description };
  }

  // ─── Date box and last update (never an empty value) ───────────────────────
  const eta = validIso(order.shipping_estimated_delivery_at) ? order.shipping_estimated_delivery_at : null;
  let dateBox: TrackingFact | null = null;
  if (!cancelled && !isPickup) {
    if (delivered) {
      dateBox = deliveredAt
        ? { label: 'Livré le', value: trackingDay(deliveredAt, now), muted: false }
        : { label: 'Livraison', value: 'Effectuée', muted: false };
    } else if (eta) {
      dateBox = { label: 'Livraison estimée', value: trackingDay(eta, now), muted: false };
    } else {
      dateBox = { label: 'Livraison estimée', value: shippedStage ? 'Pas encore communiquée par le transporteur' : 'Indiquée après l’expédition', muted: true };
    }
  }
  if (!cancelled && isPickup) {
    dateBox = presentation.stage === 'ready_for_pickup'
      ? { label: 'Retrait', value: 'Disponible en boutique', muted: false }
      : deliveredByOrder ? { label: 'Retrait', value: 'Effectué', muted: false }
        : { label: 'Retrait', value: 'En boutique, dès que la commande est prête', muted: true };
  }
  const lastUpdate = events[0]?.occurredAt ?? (validIso(order.updated_at) ? order.updated_at : null);
  const updatedAt = lastUpdate ? `Dernière mise à jour : ${shipmentDate(lastUpdate)}` : null;

  // ─── Delay notice: only from carrier data ───────────────────────────────────
  let alert: OrderTrackingView['alert'] = null;
  if (!cancelled && !isPickup && shippedStage && !delivered) {
    if (carrierStatus === 'exception') {
      alert = { title: 'Retard possible', text: 'Le transporteur a signalé un incident. Son suivi donne le détail ; nous pouvons aussi vous aider.' };
    } else if (eta && dayKey(eta) < dayKey(now.toISOString())) {
      alert = { title: 'Livraison en retard', text: `La date estimée (${trackingDay(eta, now)}) est dépassée. Le suivi du transporteur est le plus à jour.` };
    }
  }

  // ─── Carrier block ──────────────────────────────────────────────────────────
  let shipment: OrderTrackingView['shipment'] = null;
  let shipmentPending: string | null = null;
  if (!isPickup && !cancelled) {
    if (!shippedStage && !deliveredByOrder && !code) {
      shipmentPending = 'Le transporteur et le numéro de suivi apparaîtront ici dès l’expédition du colis.';
    } else {
      const url = carrierTrackingLink({ carrier: rawCarrier, trackingCode: code, providerUrl: order.shipping_tracking_url });
      shipment = {
        carrier: carrier ?? 'Transporteur non communiqué',
        carrierKnown: Boolean(carrier),
        code,
        url,
        actionLabel: carrier ? `Suivre sur ${carrier}` : 'Suivre mon colis',
        caption: carrier ? 'Transporteur de votre colis' : 'Le nom du transporteur sera indiqué dès qu’il sera connu.',
        hint: url ? null
          : code ? 'Copiez ce numéro pour le saisir sur le site du transporteur.'
            : 'Le numéro de suivi n’est pas encore disponible. Il apparaîtra ici dès qu’il nous sera communiqué.',
      };
    }
  }

  // ─── Progress ───────────────────────────────────────────────────────────────
  const keys: CustomerOrderStage[] = isPickup ? ['confirmed', 'preparing', 'ready_for_pickup', 'delivered'] : ['confirmed', 'preparing', 'shipped', 'delivered'];
  const reached = cancelled ? -1 : delivered ? keys.length - 1 : keys.indexOf(presentation.stage);
  const stepDate = (key: CustomerOrderStage): string | null => {
    const value = key === 'confirmed' ? order.created_at
      : key === 'preparing' ? order.picking_started_at
        : key === 'shipped' ? order.shipped_at
          : key === 'delivered' ? (deliveredAt ?? (deliveredByOrder ? order.updated_at : null))
            : key === 'ready_for_pickup' && presentation.stage === 'ready_for_pickup' ? order.updated_at : null;
    return validIso(value) ? shortDay(value) : null;
  };
  const steps = keys.map((key, index): TrackingStep => ({
    key,
    label: STEP_LABELS[order.fulfillment_type][key] ?? key,
    state: index < reached || (index === reached && index === keys.length - 1) ? 'done' : index === reached ? 'current' : 'todo',
    date: index <= reached ? stepDate(key) : null,
  }));

  const showEvents = !isPickup && !cancelled && (events.length > 0 || shippedStage || deliveredByOrder);
  return {
    ref: order.id.slice(0, 8).toUpperCase(),
    fulfillment: order.fulfillment_type,
    cancelled,
    hero,
    dateBox,
    updatedAt,
    alert,
    shipment,
    shipmentPending,
    steps,
    events: showEvents ? events.map((event, index) => ({ label: shipmentEventLabel(event), date: shipmentDate(event.occurredAt), latest: index === 0 })) : null,
    eventsEmpty: managed
      ? 'Le transporteur n’a pas encore publié d’étape pour ce colis.'
      : 'Les étapes détaillées sont disponibles sur le site du transporteur.',
  };
}
