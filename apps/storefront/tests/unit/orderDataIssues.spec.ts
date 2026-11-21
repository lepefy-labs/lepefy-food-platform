import { test, expect } from '@playwright/test';
import {
  orderDataIssueOccurrence,
  orderDataIssues,
  orderDataIssueSteps,
} from '../../src/lib/orders/dataQuality/orderDataIssues';
import { classifyOrderOperation, type OperationalOrder } from '../../src/lib/orders/adminOrderOperations';
import { orderDataIssueAlert, type OrderFacts } from '../../src/lib/notifications/staff/staffMessages';
import { runOrderDataChecks, type NotifyDataIssue } from '../../src/lib/orders/dataQuality/orderDataCheckRun';

const faulty = {
  status: 'preparing',
  fulfillment_type: 'delivery',
  tracking_code: null,
  shipping_address: { full_name: 'Rosah alexandra Assen', line1: 'Via felice mendelsohnn Alexandra rosah Assen' },
};

test.describe('contrôle des données de commande', () => {
  test('cas réel : numéro manquant et nom dans la rue', () => {
    expect(orderDataIssues(faulty).map((issue) => issue.code)).toEqual(['house_number_missing', 'name_in_street']);
  });

  test('adresses correctes ou « s.n. » : rien à signaler', () => {
    const ok = (line1: string, full_name = 'Marie Kamga') => orderDataIssues({ ...faulty, shipping_address: { full_name, line1 } });
    expect(ok('Via Roma 25')).toEqual([]);
    expect(ok('Via XX Settembre 12/B')).toEqual([]);
    expect(ok('Via grande s.n.')).toEqual([]);
    expect(ok('Via Giuseppe Verdi 3', 'Giuseppe Verdi')).toEqual([]);
  });

  test('Italie : type de voie manquant et numéro répété dans le complément (#4FC1BC4F)', () => {
    const it = (line1: string, line2: string | null = null) => orderDataIssues({
      ...faulty, shipping_address: { full_name: 'Francine Mafotsing', line1, line2, country: 'IT' },
    }).map((issue) => issue.code);
    expect(it('Roma 10', '10')).toEqual(['street_type_missing', 'house_number_repeated']);
    expect(it('Svezia 44')).toEqual(['street_type_missing']);
    expect(it('Stada statale per voghera 12', 'Premier niveau')).toEqual(['street_type_missing']);
    // Types de voie et abréviations courantes : rien à signaler.
    for (const line1 of ['Via Roma 10', 'via roma 10', 'V.le Europa 3', 'P.za Garibaldi 1', 'Piazzale Loreto 2', 'Corso Italia 5',
      'C.so Vittorio 7', 'Loc. Santa Maria 4', 'Località Pian del Sole 2', 'Frazione Ca’ Bianca 1', 'Contrada Fiumara 9',
      'Strada Statale 7 12', 'SS 113 45', 'Vicolo Stretto 3', 'Lungomare Colombo 10', 'Borgo Pinti 21', '4 Novembre 12']) {
      expect(it(line1), line1).toEqual([]);
    }
    // Complément utile ou numéro différent : pas de répétition.
    expect(it('Via Roma 10', 'Scala B')).toEqual([]);
    expect(it('Via Roma 10', '12')).toEqual([]);
    expect(it('Via Roma 10', 'n. 10')).toEqual(['house_number_repeated']);
    expect(it('Via Roma 10', 'civico 10')).toEqual(['house_number_repeated']);
    // Hors Italie : le type de voie n'est pas exigé.
    expect(orderDataIssues({ ...faulty, shipping_address: { full_name: 'Marie Kamga', line1: 'Grand-Rue 4', country: 'BE' } })).toEqual([]);
  });

  test('marche à suivre et message WhatsApp pour le type de voie', () => {
    const issues = orderDataIssues({ ...faulty, shipping_address: { full_name: 'Francine Mafotsing', line1: 'Roma 10', line2: '10', country: 'IT' } });
    const steps = orderDataIssueSteps(issues, 'Packlink');
    expect(steps[0]).toContain('type de voie (Via, Piazza…)');
    expect(steps[1]).toContain('laissez « Complément » vide');
    expect(steps[2]).toContain('Refaites le brouillon Packlink');
  });

  test('nom du destinataire incomplet', () => {
    const issues = orderDataIssues({ ...faulty, shipping_address: { full_name: 'Atsague J', line1: 'Via Roma 25' } });
    expect(issues.map((issue) => issue.code)).toEqual(['recipient_name_incomplete']);
  });

  test('hors périmètre : retrait, expédiée, étiquette achetée, close', () => {
    expect(orderDataIssues({ ...faulty, fulfillment_type: 'pickup' })).toEqual([]);
    expect(orderDataIssues({ ...faulty, status: 'shipped' })).toEqual([]);
    expect(orderDataIssues({ ...faulty, status: 'delivered' })).toEqual([]);
    expect(orderDataIssues({ ...faulty, tracking_code: '1UW1YZT0000' })).toEqual([]);
    expect(orderDataIssues({ ...faulty, shipping_address: null })).toEqual([]);
  });

  test('occurrence : stable pour la même adresse, nouvelle après une autre erreur', () => {
    const issues = orderDataIssues(faulty);
    const first = orderDataIssueOccurrence(faulty, issues);
    expect(orderDataIssueOccurrence(faulty, issues)).toBe(first);
    expect(first).toMatch(/^address:house_number_missing\+name_in_street:[0-9a-f]{8}$/);
    expect(first).not.toContain('Assen');
    const other = { ...faulty, shipping_address: { ...faulty.shipping_address, line1: 'Via Mendelssohn Assen' } };
    expect(orderDataIssueOccurrence(other, orderDataIssues(other))).not.toBe(first);
  });

  test('marche à suivre : brouillon transporteur seulement s’il existe', () => {
    const issues = orderDataIssues(faulty);
    expect(orderDataIssueSteps(issues, 'Packlink')).toHaveLength(4);
    expect(orderDataIssueSteps(issues, 'Packlink')[2]).toContain('Refaites le brouillon Packlink');
    expect(orderDataIssueSteps(issues, null)).toHaveLength(3);
    expect(orderDataIssueSteps(issues, null)[0]).toContain('numéro de la maison');
  });
});

test.describe('signalement dans l’admin (classificateur)', () => {
  const base: OperationalOrder = {
    id: 'ae9d9fbf-0000-0000-0000-000000000000', status: 'preparing', fulfillment_type: 'delivery', payment_status: 'paid',
    created_at: '2026-11-14T16:28:00Z', updated_at: '2026-11-14T16:28:00Z', shipping_address: { country: 'IT', ...faulty.shipping_address },
  } as OperationalOrder;
  const thresholds = { prepareHours: 1000, pickupHours: 1000, trackingStaleHours: 1000 };

  test('« Adresse à vérifier » en Action requise, action « Corriger l’adresse »', () => {
    const operation = classifyOrderOperation(base, thresholds, new Date('2026-11-16T10:00:00Z'));
    expect(operation.anomaly).toEqual({ code: 'address_to_check', label: 'Adresse à vérifier' });
    expect(operation.group).toBe('action_required');
    expect(operation.flags.has('urgent')).toBe(true);
    expect(operation.action).toMatchObject({ label: 'Corriger l’adresse', section: 'address' });
  });

  test('adresse corrigée : plus d’anomalie', () => {
    const fixed = { ...base, shipping_address: { country: 'IT', full_name: 'Rosah alexandra Assen', line1: 'Via Felice Mendelssohn 12' } };
    expect(classifyOrderOperation(fixed, thresholds, new Date('2026-11-16T10:00:00Z')).anomaly).toBeNull();
  });
});

test.describe('e-mail « Commande à vérifier »', () => {
  const facts = {
    orderId: 'ae9d9fbf-0000-0000-0000-000000000000', orderNumber: '#AE9D9FBF', customer: 'Rosah A.', total: 107.49, items: 5,
    fulfillment: 'delivery', paymentLabel: 'Carte', paymentPending: false, destinationCountry: 'IT', international: false,
    fresh: false, frozen: false, assisted: false, shipment: null,
  } as OrderFacts;

  test('sans l’adresse, avec les étapes numérotées', () => {
    const issues = orderDataIssues(faulty);
    const alert = orderDataIssueAlert(facts, issues.map((issue) => issue.description), orderDataIssueSteps(issues, 'Packlink'));
    expect(alert.title).toBe('Adresse à vérifier · #AE9D9FBF');
    expect(alert.indicators[0]).toBe('Le contrôle automatique a relevé une anomalie sur une commande.');
    expect(alert.indicators).toContain('⚠️ Le numéro de la maison manque');
    expect(alert.note?.split('\n')).toHaveLength(5);
    expect(JSON.stringify(alert)).not.toContain('mendelsohnn');
    expect(alert.link?.path).toBe('/admin/orders/ae9d9fbf-0000-0000-0000-000000000000');
  });
});

test.describe('tick horaire', () => {
  function fakeDb(rows: unknown[]) {
    const filters: string[] = [];
    const query = {
      select: () => query,
      in: (column: string) => { filters.push(`in:${column}`); return query; },
      eq: (column: string, value: unknown) => { filters.push(`eq:${column}=${String(value)}`); return query; },
      is: (column: string) => { filters.push(`is:${column}`); return query; },
      gte: (column: string) => { filters.push(`gte:${column}`); return query; },
      order: () => query,
      limit: async () => ({ data: rows, error: null }),
    };
    return { db: { from: () => query } as never, filters };
  }

  test('ne signale que les commandes fautives ; doublons et absence de destinataire comptés à part', async () => {
    const rows = [
      { id: 'a', tenant_id: 't', ...faulty, shipping_provider_reference: 'IT2026PRO1', shipping_provider_key: 'packlink' },
      { id: 'b', tenant_id: 't', ...faulty, shipping_address: { full_name: 'Marie Kamga', line1: 'Via Roma 25' }, shipping_provider_reference: null, shipping_provider_key: null },
      { id: 'c', tenant_id: 't', ...faulty, shipping_provider_reference: null, shipping_provider_key: null },
      { id: 'd', tenant_id: 'u', ...faulty, shipping_provider_reference: null, shipping_provider_key: null },
    ];
    const { db, filters } = fakeDb(rows);
    const calls: Array<{ orderId: string; steps: number }> = [];
    const outcome: Record<string, { queued: number; alreadyQueued: number }> = { a: { queued: 1, alreadyQueued: 0 }, c: { queued: 0, alreadyQueued: 1 }, d: { queued: 0, alreadyQueued: 0 } };
    const notify: NotifyDataIssue = async (_tenant, orderId, _issues, steps) => {
      calls.push({ orderId, steps: steps.length });
      return { eventId: 'e', deliveryIds: [], attempted: 0, accepted: 0, targets: { email: 1, whatsapp: 0 }, ...outcome[orderId]! } as never;
    };
    const summary = await runOrderDataChecks(db, notify, new Date('2026-11-16T10:00:00Z'));
    expect(summary).toEqual({ scanned: 4, withIssues: 3, notified: 1, alreadyNotified: 1, noRecipient: 1, failed: 0 });
    expect(calls).toEqual([{ orderId: 'a', steps: 4 }, { orderId: 'c', steps: 3 }, { orderId: 'd', steps: 3 }]);
    expect(filters).toEqual(expect.arrayContaining(['eq:is_test=false', 'eq:payment_status=paid', 'eq:fulfillment_type=delivery', 'is:tracking_code']));
  });
});
