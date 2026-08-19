// Script Node standalone — NON eseguito automaticamente dall'agente e2e.
// Stessa logica di cleanup-test-data.ts ma SENZA filtro temporale (ultime
// 24h) — uso manuale quando un run Playwright crasha a metà e lascia dati
// orfani. Chiede conferma esplicita prima di eseguire.
//
// Esecuzione manuale: pnpm tsx tests/e2e/scripts/reconcile-test-data.ts

import { createClient } from '@supabase/supabase-js';
import * as readline from 'readline';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('[reconcile-test-data] NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY mancanti.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface Summary {
  ordersDeleted: number;
  orderItemsDeleted: number;
  stockRestoredLines: number;
  reservationsDeleted: number;
  reservationItemsDeleted: number;
  capacityRestoredLines: number;
  anomalies: string[];
}

function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function cleanupOrders(summary: Summary) {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, status')
    .eq('is_test', true);

  if (error) {
    console.error('[reconcile-test-data] Errore lettura orders is_test:', error);
    return;
  }

  console.info(`[reconcile-test-data] Trovati ${orders?.length ?? 0} ordini is_test (tutti, nessun filtro temporale).`);

  for (const order of orders ?? []) {
    const stockWasDecremented = order.status !== 'stock_conflict';

    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('product_id, quantity')
      .eq('order_id', order.id);

    if (itemsError) {
      console.error(`[reconcile-test-data] Errore lettura order_items — order: ${order.id}`, itemsError);
      continue;
    }

    if (!items || items.length === 0) {
      summary.anomalies.push(`order ${order.id} — is_test senza order_items`);
      console.warn(`[reconcile-test-data] Anomalia: ordine ${order.id} (is_test) senza order_items.`);
    }

    if (stockWasDecremented) {
      for (const item of items ?? []) {
        if (!item.product_id) continue;
        const { data: product, error: productError } = await supabase
          .from('products')
          .select('stock')
          .eq('id', item.product_id)
          .maybeSingle();

        if (productError || !product) {
          summary.anomalies.push(`order ${order.id} — product ${item.product_id} introvabile per ripristino stock`);
          console.warn(`[reconcile-test-data] Prodotto ${item.product_id} introvabile — stock non ripristinato per ordine ${order.id}.`);
          continue;
        }

        const { error: restoreError } = await supabase
          .from('products')
          .update({ stock: product.stock + item.quantity })
          .eq('id', item.product_id);

        if (restoreError) {
          console.error(`[reconcile-test-data] Errore ripristino stock — product: ${item.product_id}`, restoreError);
          continue;
        }

        console.info(`[reconcile-test-data] Stock ripristinato — product: ${item.product_id} — +${item.quantity}`);
        summary.stockRestoredLines += 1;
      }
    }

    const { error: deleteItemsError } = await supabase.from('order_items').delete().eq('order_id', order.id);
    if (deleteItemsError) {
      console.error(`[reconcile-test-data] Errore cancellazione order_items — order: ${order.id}`, deleteItemsError);
      continue;
    }
    console.info(`[reconcile-test-data] order_items cancellati — order: ${order.id} — righe: ${items?.length ?? 0}`);
    summary.orderItemsDeleted += items?.length ?? 0;

    const { error: deleteOrderError } = await supabase.from('orders').delete().eq('id', order.id);
    if (deleteOrderError) {
      console.error(`[reconcile-test-data] Errore cancellazione order — order: ${order.id}`, deleteOrderError);
      continue;
    }
    console.info(`[reconcile-test-data] Ordine cancellato — order: ${order.id}`);
    summary.ordersDeleted += 1;
  }
}

async function cleanupEventReservations(summary: Summary) {
  const { data: reservations, error } = await supabase
    .from('event_reservations')
    .select('id, event_id, status, quantity_total')
    .eq('is_test', true);

  if (error) {
    console.error('[reconcile-test-data] Errore lettura event_reservations is_test:', error);
    return;
  }

  console.info(`[reconcile-test-data] Trovate ${reservations?.length ?? 0} prenotazioni eventi is_test (tutte, nessun filtro temporale).`);

  for (const reservation of reservations ?? []) {
    const capacityWasDecremented = reservation.status === 'confirmed';

    const { data: items, error: itemsError } = await supabase
      .from('event_reservation_items')
      .select('id')
      .eq('reservation_id', reservation.id);

    if (itemsError) {
      console.error(`[reconcile-test-data] Errore lettura event_reservation_items — reservation: ${reservation.id}`, itemsError);
      continue;
    }

    if (!items || items.length === 0) {
      summary.anomalies.push(`reservation ${reservation.id} — is_test senza event_reservation_items`);
      console.warn(`[reconcile-test-data] Anomalia: prenotazione ${reservation.id} (is_test) senza items.`);
    }

    if (capacityWasDecremented) {
      const { error: restoreError } = await supabase.rpc('restore_event_capacity', {
        p_event_id: reservation.event_id,
        p_quantity: reservation.quantity_total,
      });

      if (restoreError) {
        console.error(`[reconcile-test-data] Errore ripristino capacità — event: ${reservation.event_id}`, restoreError);
      } else {
        console.info(`[reconcile-test-data] Capacità ripristinata — event: ${reservation.event_id} — +${reservation.quantity_total}`);
        summary.capacityRestoredLines += 1;
      }
    }

    const { error: deleteItemsError } = await supabase
      .from('event_reservation_items')
      .delete()
      .eq('reservation_id', reservation.id);
    if (deleteItemsError) {
      console.error(`[reconcile-test-data] Errore cancellazione event_reservation_items — reservation: ${reservation.id}`, deleteItemsError);
      continue;
    }
    console.info(`[reconcile-test-data] event_reservation_items cancellati — reservation: ${reservation.id} — righe: ${items?.length ?? 0}`);
    summary.reservationItemsDeleted += items?.length ?? 0;

    const { error: deleteReservationError } = await supabase
      .from('event_reservations')
      .delete()
      .eq('id', reservation.id);
    if (deleteReservationError) {
      console.error(`[reconcile-test-data] Errore cancellazione reservation — reservation: ${reservation.id}`, deleteReservationError);
      continue;
    }
    console.info(`[reconcile-test-data] Prenotazione cancellata — reservation: ${reservation.id}`);
    summary.reservationsDeleted += 1;
  }
}

async function main() {
  const { count: ordersCount } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('is_test', true);

  const { count: reservationsCount } = await supabase
    .from('event_reservations')
    .select('id', { count: 'exact', head: true })
    .eq('is_test', true);

  const totalCount = (ordersCount ?? 0) + (reservationsCount ?? 0);

  if (totalCount === 0) {
    console.info('[reconcile-test-data] Nessun dato is_test trovato. Niente da fare.');
    return;
  }

  const confirmed = await askConfirmation(
    `Confermi cancellazione di ${totalCount} record test (${ordersCount ?? 0} ordini, ${reservationsCount ?? 0} prenotazioni)? [y/N] `,
  );

  if (!confirmed) {
    console.info('[reconcile-test-data] Annullato dall\'utente. Nessuna modifica effettuata.');
    return;
  }

  const summary: Summary = {
    ordersDeleted: 0,
    orderItemsDeleted: 0,
    stockRestoredLines: 0,
    reservationsDeleted: 0,
    reservationItemsDeleted: 0,
    capacityRestoredLines: 0,
    anomalies: [],
  };

  try {
    await cleanupOrders(summary);
    await cleanupEventReservations(summary);
  } catch (err) {
    console.error('[reconcile-test-data] Errore inatteso, interruzione:', err);
    process.exitCode = 1;
  }

  console.info('─── Riepilogo reconcile-test-data ───────────────────────────');
  console.info(`Ordini cancellati:              ${summary.ordersDeleted}`);
  console.info(`order_items cancellati:         ${summary.orderItemsDeleted}`);
  console.info(`Righe stock ripristinate:       ${summary.stockRestoredLines}`);
  console.info(`Prenotazioni eventi cancellate:  ${summary.reservationsDeleted}`);
  console.info(`event_reservation_items cancellati: ${summary.reservationItemsDeleted}`);
  console.info(`Righe capacità ripristinate:     ${summary.capacityRestoredLines}`);
  if (summary.anomalies.length > 0) {
    console.warn(`Anomalie riscontrate (${summary.anomalies.length}):`);
    summary.anomalies.forEach((a) => console.warn(`  - ${a}`));
  } else {
    console.info('Nessuna anomalia riscontrata.');
  }
}

main();
