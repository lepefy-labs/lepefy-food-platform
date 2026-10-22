import { test, expect } from '@playwright/test';
import { buildOrderTrackingView, type TrackingOrderInput } from '../../src/lib/orders/tracking/orderTrackingView';

const NOW = new Date('2026-10-22T16:00:00Z');

function order(overrides: Partial<TrackingOrderInput> = {}): TrackingOrderInput {
  return {
    id: '5ca23a93-1111-4222-8333-444455556666', status: 'shipped', fulfillment_type: 'delivery',
    created_at: '2026-10-18T12:12:00Z', updated_at: '2026-10-21T09:00:00Z', shipped_at: '2026-10-20T10:00:00Z',
    picking_started_at: '2026-10-19T08:00:00Z', tracking_code: '1UW1YZT056163', tracking_carrier: 'Poste Italiane',
    shipping_tracking_mode: 'managed', shipping_provider_reference: 'IT2026PRO0006943905', shipping_normalized_status: 'in_transit',
    shipping_tracking_url: 'https://www.poste.it/cerca/index.html#/risultati-spedizioni/',
    shipping_estimated_delivery_at: '2026-10-23T00:00:00Z',
    shipping_tracking_events: [
      { occurredAt: '2026-10-20T15:00:00Z', description: 'Presa in carico', providerStatus: null, status: 'in_transit' },
      { occurredAt: '2026-10-22T12:52:00Z', description: 'In transito', providerStatus: null, status: 'in_transit' },
    ],
    ...overrides,
  };
}

test('normal shipment: carrier headline, estimated day, last move, Poste link with the code, 3 of 4 steps', () => {
  const view = buildOrderTrackingView(order(), NOW);
  expect(view.ref).toBe('5CA23A93');
  expect(view.hero).toMatchObject({ tone: 'progress', kicker: 'Statut transporteur', title: 'Votre colis est en transit', detail: 'Il poursuit son trajet avec Poste Italiane.' });
  expect(`${view.hero.title} ${view.hero.detail}`).not.toMatch(/aujourd/i);
  expect(view.dateBox).toEqual({ label: 'Livraison estimée', value: 'vendredi 23 octobre', muted: false });
  // Last carrier event, not the order row.
  expect(view.updatedAt).toMatch(/^Dernière mise à jour : 22 oct\. 2026/);
  expect(view.alert).toBeNull();
  expect(view.shipment).toMatchObject({
    carrier: 'Poste Italiane', code: '1UW1YZT056163', actionLabel: 'Suivre sur Poste Italiane', caption: 'Transporteur de votre colis', hint: null,
    url: 'https://www.poste.it/cerca/index.html#/risultati-spedizioni/1UW1YZT056163',
  });
  expect(view.steps.map((s) => [s.label, s.state])).toEqual([['Confirmée', 'done'], ['Préparée', 'done'], ['Expédiée', 'current'], ['Livrée', 'todo']]);
  expect(view.steps[3]!.date).toBeNull();
  expect(view.events?.[0]).toMatchObject({ label: 'In transito', latest: true });
});

test('delay: shown only when the carrier date is past or the carrier reports an incident', () => {
  const late = buildOrderTrackingView(order({ shipping_estimated_delivery_at: '2026-10-21T00:00:00Z' }), NOW);
  expect(late.alert?.title).toBe('Livraison en retard');
  expect(late.alert?.text).toContain('mercredi 21 octobre');
  // Same day as the estimate: not late yet.
  expect(buildOrderTrackingView(order({ shipping_estimated_delivery_at: '2026-10-22T00:00:00Z' }), NOW).alert).toBeNull();
  const incident = buildOrderTrackingView(order({ shipping_normalized_status: 'exception' }), NOW);
  expect(incident.hero).toMatchObject({ tone: 'warning', title: 'Incident de livraison', detail: 'Poste Italiane signale un problème sur la livraison de votre colis.' });
  expect(incident.alert?.title).toBe('Retard possible');
  // No estimate and no incident: no delay is ever inferred from the shipping age.
  expect(buildOrderTrackingView(order({ shipping_estimated_delivery_at: null, shipped_at: '2026-09-01T10:00:00Z' }), NOW).alert).toBeNull();
});

test('delivered: by the shop or by the carrier first; delivery date from the carrier event, all steps done', () => {
  const events = [{ occurredAt: '2026-10-22T09:30:00Z', description: 'Consegnata', providerStatus: null, status: 'delivered' as const }];
  for (const view of [
    buildOrderTrackingView(order({ status: 'delivered', shipping_normalized_status: 'delivered', shipping_tracking_events: events }), NOW),
    buildOrderTrackingView(order({ shipping_normalized_status: 'delivered', shipping_tracking_events: events }), NOW),
  ]) {
    expect(view.hero).toMatchObject({ tone: 'success', title: 'Votre colis a été livré' });
    expect(view.dateBox).toEqual({ label: 'Livré le', value: 'jeudi 22 octobre', muted: false });
    expect(view.alert).toBeNull();
    expect(view.steps.every((s) => s.state === 'done')).toBe(true);
  }
});

test('tracking not available yet: before shipping a clear placeholder, after shipping clear fallbacks, no empty field', () => {
  const preparing = buildOrderTrackingView(order({ status: 'preparing', tracking_code: null, tracking_carrier: null, shipping_tracking_mode: null,
    shipping_provider_reference: null, shipping_normalized_status: null, shipping_tracking_url: null, shipping_estimated_delivery_at: null, shipping_tracking_events: [] }), NOW);
  expect(preparing.hero.title).toBe('Nous préparons votre commande');
  expect(preparing.shipment).toBeNull();
  expect(preparing.shipmentPending).toContain('dès l’expédition');
  expect(preparing.hero.kicker).toBe('Statut de la commande');
  expect(preparing.dateBox).toEqual({ label: 'Livraison estimée', value: 'Indiquée après l’expédition', muted: true });
  expect(preparing.updatedAt).toMatch(/^Dernière mise à jour : 21 oct\. 2026/);
  expect(preparing.events).toBeNull();
  expect(preparing.steps.map((s) => s.state)).toEqual(['done', 'current', 'todo', 'todo']);

  const shippedBare = buildOrderTrackingView(order({ tracking_code: null, tracking_carrier: null, shipping_details: null, shipping_tracking_mode: 'manual',
    shipping_normalized_status: null, shipping_tracking_url: null, shipping_estimated_delivery_at: null, shipping_tracking_events: [] }), NOW);
  expect(shippedBare.hero).toMatchObject({ kicker: 'Statut de la commande', title: 'Votre commande est expédiée' });
  // Nothing to follow yet: no invitation to use the carrier site.
  expect(shippedBare.hero.detail).toBe('Le colis a été remis au transporteur.');
  expect(shippedBare.dateBox).toMatchObject({ value: 'Pas encore communiquée par le transporteur', muted: true });
  expect(shippedBare.shipment).toMatchObject({ carrier: 'Transporteur non communiqué', carrierKnown: false, code: null, url: null, actionLabel: 'Suivre mon colis' });
  expect(shippedBare.shipment?.hint).toContain('pas encore disponible');
  expect(shippedBare.events).toEqual([]);
  for (const box of [preparing.dateBox, shippedBare.dateBox]) expect(box?.value.trim()).toBeTruthy();

  // Manual code with an unknown carrier: no link to invent, copy hint instead.
  const manual = buildOrderTrackingView(order({ shipping_tracking_mode: 'manual', tracking_carrier: 'Colissimo', shipping_tracking_url: null }), NOW);
  expect(manual.shipment).toMatchObject({ carrier: 'Colissimo', url: null, hint: expect.stringContaining('Copiez') });
});

test('order status and carrier status stay apart: no carrier headline before shipping or for manual tracking', () => {
  // Carrier already moving while the shop has not marked the order shipped.
  expect(buildOrderTrackingView(order({ status: 'preparing' }), NOW).hero.title).toBe('Nous préparons votre commande');
  // Manual tracking has no carrier status to trust.
  const manual = buildOrderTrackingView(order({ shipping_tracking_mode: 'manual' }), NOW);
  expect(manual.hero).toMatchObject({ kicker: 'Statut de la commande', title: 'Votre commande est expédiée' });
  expect(manual.hero.detail).toBe('Le colis a été remis à Poste Italiane. Suivez son avancement sur le site du transporteur.');
  expect(buildOrderTrackingView(order({ shipping_normalized_status: 'out_for_delivery' }), NOW).hero.title).toBe('Votre colis est en cours de livraison');
  expect(buildOrderTrackingView(order({ shipping_normalized_status: 'pending' }), NOW).hero.title).toBe('Votre commande est expédiée');
});

test('cancelled and pickup orders: no shipment block, pickup steps', () => {
  const cancelled = buildOrderTrackingView(order({ status: 'cancelled' }), NOW);
  expect(cancelled).toMatchObject({ cancelled: true, shipment: null, alert: null, events: null });
  expect(cancelled.hero.tone).toBe('danger');
  expect(cancelled.dateBox).toBeNull();

  const pickup = buildOrderTrackingView(order({ fulfillment_type: 'pickup', status: 'ready_for_pickup', tracking_code: null }), NOW);
  expect(pickup).toMatchObject({ shipment: null, shipmentPending: null, events: null });
  expect(pickup.hero).toMatchObject({ tone: 'success', title: 'Votre commande est prête' });
  expect(pickup.dateBox).toEqual({ label: 'Retrait', value: 'Disponible en boutique', muted: false });
  expect(pickup.steps.map((s) => [s.label, s.state])).toEqual([['Confirmée', 'done'], ['Préparée', 'done'], ['Prête', 'current'], ['Retirée', 'todo']]);
});
