import { round2 } from './random.mjs';

/**
 * Contrôles de cohérence d'un plan avant toute écriture. Retourne la liste des
 * problèmes (vide = plan valide). Mêmes règles que le produit : totaux, règles
 * de quantité, mode de réception, capacité des soirées, identités fictives.
 */
export function validatePlan(scenario, plan) {
  const issues = [];
  const rows = (table) => plan.tables.find((entry) => entry.table === table)?.rows ?? [];
  const products = rows('products');
  const productById = new Map(products.map((row) => [row.id, row]));

  const slugs = new Set();
  for (const product of products) {
    if (slugs.has(product.slug)) issues.push(`slug produit en double : ${product.slug}`);
    slugs.add(product.slug);
    if (!(product.price >= 0)) issues.push(`prix invalide : ${product.slug}`);
    if (product.stock < 0) issues.push(`stock négatif : ${product.slug}`);
    if (product.compare_at_price !== null && !(product.compare_at_price > product.price)) issues.push(`prix barré ≤ prix : ${product.slug}`);
    if (!product.category_id) issues.push(`catégorie inconnue : ${product.slug}`);
  }

  const itemsByOrder = new Map();
  for (const item of rows('order_items')) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
    const product = productById.get(item.product_id);
    if (!product) { issues.push(`ligne sans produit : ${item.id}`); continue; }
    const min = product.min_order_quantity; const step = product.order_quantity_step;
    if (item.quantity < min || (item.quantity - min) % step !== 0) issues.push(`quantité hors règle (${product.slug} × ${item.quantity})`);
    if (round2(item.price * item.quantity) !== item.subtotal) issues.push(`sous-total de ligne faux : ${item.id}`);
  }
  for (const order of rows('orders')) {
    const items = itemsByOrder.get(order.id) ?? [];
    if (!items.length) issues.push(`commande sans ligne : ${order.notes}`);
    const subtotal = round2(items.reduce((sum, item) => sum + item.subtotal, 0));
    if (subtotal !== order.subtotal) issues.push(`sous-total faux : ${order.notes}`);
    if (round2(order.subtotal + order.shipping_cost) !== order.total) issues.push(`total faux : ${order.notes}`);
    if (order.fulfillment_type === 'delivery' && items.some((item) => productById.get(item.product_id)?.fulfillment_policy === 'pickup_only')) {
      issues.push(`livraison d'un produit à retirer : ${order.notes}`);
    }
    if (order.email && !order.email.endsWith('@example.com')) issues.push(`e-mail non fictif : ${order.notes}`);
  }

  for (const customer of rows('customers')) {
    if (!customer.email.endsWith('@example.com')) issues.push(`e-mail client non fictif : ${customer.id}`);
    if (!customer.phone.startsWith('+33 6 39 98 ')) issues.push(`téléphone hors plage fictive : ${customer.id}`);
  }

  const reservedByEvent = new Map();
  const itemsByReservation = new Map(rows('event_reservation_items').map((item) => [item.reservation_id, item]));
  for (const reservation of rows('event_reservations')) {
    reservedByEvent.set(reservation.event_id, (reservedByEvent.get(reservation.event_id) ?? 0) + reservation.quantity_total);
    const item = itemsByReservation.get(reservation.id);
    if (!item || round2(item.unit_price * item.quantity) !== reservation.amount_paid) issues.push(`montant de réservation faux : ${reservation.id}`);
  }
  for (const event of rows('events')) {
    if (event.capacity_remaining < 0 || event.capacity_total - (reservedByEvent.get(event.id) ?? 0) !== event.capacity_remaining) issues.push(`capacité incohérente : ${event.slug}`);
  }

  const v = scenario.volumes;
  if (rows('customers').length !== v.customers) issues.push(`clients : ${rows('customers').length} au lieu de ${v.customers}`);
  if (rows('orders').length !== v.orders) issues.push(`commandes : ${rows('orders').length} au lieu de ${v.orders}`);
  return issues;
}
