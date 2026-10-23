import { createRandom, round2, seedFrom, stableHex, stableUuid } from './random.mjs';

/**
 * Transforme un scénario (scripts/demo/scenarios) en lignes prêtes à écrire.
 * Pur et déterministe : (scénario, tenantId, date d'ancrage) → même plan.
 * Les dates sont relatives à l'ancrage pour que « Aujourd'hui » reste crédible
 * après chaque remise à zéro. Chaque lot d'une table a les mêmes colonnes
 * (une insertion PostgREST groupée ne garde que les colonnes communes).
 *
 * Identités : prénoms et noms combinés au hasard, e-mails @example.com,
 * téléphones dans la plage réservée à la fiction par l'ARCEP (06 39 98 xx xx).
 */

const FIRST_NAMES = ['Awa', 'Fatou', 'Aminata', 'Mariam', 'Aïssatou', 'Nadia', 'Clara', 'Sophie', 'Léa', 'Inès', 'Grace', 'Esther', 'Ruth', 'Chloé', 'Camille',
  'Moussa', 'Ibrahima', 'Koffi', 'Yao', 'Ousmane', 'Mamadou', 'Julien', 'Thomas', 'Karim', 'Samuel', 'David', 'Hugo', 'Lucas', 'Serge', 'Patrick'];
const LAST_NAMES = ['Diop', 'Ndiaye', 'Traoré', 'Koné', 'Diallo', 'Camara', 'Mensah', 'Kouassi', 'Touré', 'Sow', 'Bamba', 'Martin', 'Bernard', 'Petit', 'Robert',
  'Richard', 'Durand', 'Moreau', 'Laurent', 'Simon', 'Michel', 'Lefèvre', 'Mbappé', 'Okafor', 'Adeyemi', 'Nkemelu', 'Eto', 'Abena', 'Fofana', 'Sylla'];

const ascii = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z]/g, '').toLowerCase();
const fictionPhone = (n) => `+33 6 39 98 ${String(Math.floor(n / 100) % 100).padStart(2, '0')} ${String(n % 100).padStart(2, '0')}`;

/** Instant à `days` jours de l'ancrage, à l'heure `hour` (UTC, ≈ heure de Paris − 1/2). */
function at(anchor, days, hour = 12, minute = 0) {
  const date = new Date(anchor);
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}
const dateOnly = (anchor, days) => at(anchor, days).slice(0, 10);

export function demoTenantRow(scenario, { slug, appUrl }) {
  const t = scenario.tenant;
  return {
    slug, name: t.name, tagline: t.tagline, logo_url: null,
    primary_color: t.primary_color, secondary_color: t.secondary_color, accent_light: t.accent_light,
    city: t.city, country: t.country, currency: 'EUR', locale: 'fr-FR',
    click_collect_enabled: true, click_collect_address: t.click_collect_address, click_collect_hours: t.click_collect_hours,
    active: true, shipping_provider: 'flat_rate', flat_rate_amount: t.flat_rate_amount, packlink_api_key: null,
    show_powered_by: true, storefront_ready: true, storefront_url: appUrl || null,
    story_heading: t.story_heading, story_text: t.story_text, chatbox_extra_context: t.chatbox_extra_context,
    legal_name: t.legal_name, legal_address: t.legal_address, legal_email: 'demo@lepefy.com', legal_website: appUrl || null,
    whatsapp_number: null, stripe_account_id: null,
    events_enabled: true, services_enabled: true,
    // Coût de l'IA borné : limites publiques du tenant (check_ai_rate_limit), en plus de la limite par visiteur.
    ai_rate_limit_public_per_minute: 6, ai_rate_limit_public_per_day: 300,
    is_test: true, is_demo: true,
  };
}

/** Modules commerciaux ouverts sur le tenant de démo (tenant_feature_overrides + tenant_feature_settings). */
export const DEMO_FEATURE_KEYS = ['shop', 'events', 'digital_card', 'ai', 'nala', 'nala_analytics', 'reviews', 'loyalty', 'order_documents', 'order_preparation'];
export const DEMO_FEATURE_FLAGS = ['business_management'];

export function buildPlan(scenario, { tenantId, anchor, appUrl = '' }) {
  const rng = createRandom(seedFrom(`${scenario.key}:${scenario.version}`));
  const id = (key) => stableUuid(tenantId, key);
  const tables = [];
  const push = (table, rows) => { if (rows.length) tables.push({ table, rows }); };

  // ─── Modules ───────────────────────────────────────────────────────────────
  push('tenant_feature_flags', DEMO_FEATURE_FLAGS.map((flag_key) => ({ tenant_id: tenantId, flag_key, enabled: true })));
  push('tenant_feature_overrides', DEMO_FEATURE_KEYS.map((feature_key) => ({ tenant_id: tenantId, feature_key, enabled: true, source: 'manual' })));
  push('tenant_feature_settings', DEMO_FEATURE_KEYS.map((feature_key) => ({ tenant_id: tenantId, feature_key, enabled: true, config: {} })));
  push('tenant_payment_methods', [{
    id: id('payment-method:link'), tenant_id: tenantId, method: 'other', label: 'Lien de paiement (simulé)',
    value: `${appUrl}/demo/paiement-simule`, sort_order: 0, active: true, enabled_modules: ['shop', 'event', 'rental'],
  }]);

  // ─── Catalogue ─────────────────────────────────────────────────────────────
  const categories = scenario.categories.map((category, position) => ({ id: id(`category:${category.slug}`), tenant_id: tenantId, name: category.name, slug: category.slug, position }));
  push('categories', categories);
  const categoryId = new Map(categories.map((row) => [row.slug, row.id]));

  const products = scenario.products.map(([slug, category, name, price, weight, options], position) => {
    const promo = options.promo ?? null;
    const lowStock = slug === 'ndole' ? 3 : slug === 'bouye-50' ? 0 : null;
    return {
      id: id(`product:${slug}`), tenant_id: tenantId, category_id: categoryId.get(category), slug, name,
      description: `${name}. Exemple de la boutique de démonstration : prix et disponibilité fictifs.`,
      price, compare_at_price: promo, weight_grams: weight,
      stock: options.stock ?? lowStock ?? rng.int(options.pickup ? 18 : 12, options.pickup ? 60 : 80),
      active: true, featured: Boolean(options.featured), position,
      storage_type: options.storage ?? (options.pickup ? 'fresh' : 'dry'),
      fulfillment_policy: options.pickup ? 'pickup_only' : 'delivery_or_pickup',
      min_order_quantity: options.min ?? 1, order_quantity_step: options.step ?? 1,
      new_until: options.novelty ? at(anchor, 10 + (position % 5), 22) : null,
      add_on_position: options.addOn ?? null,
      is_homemade: Boolean(options.pickup) || category === 'boissons' || category === 'desserts',
    };
  });
  push('products', products);
  const productBySlug = new Map(products.map((row) => [row.slug, row]));

  // ─── Clients ───────────────────────────────────────────────────────────────
  const customers = [];
  const usedNames = new Set();
  for (let n = 0; customers.length < scenario.volumes.customers; n++) {
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    if (usedNames.has(`${first} ${last}`)) continue;
    usedNames.add(`${first} ${last}`);
    const index = customers.length + 1;
    customers.push({
      id: id(`customer:${index}`), tenant_id: tenantId, full_name: `${first} ${last}`,
      email: `${ascii(first)}.${ascii(last)}.${index}@example.com`, phone: fictionPhone(index),
      source: rng.chance(0.6) ? 'guest_checkout' : 'signup', created_at: at(anchor, -rng.int(30, 220), rng.int(8, 20), rng.int(0, 59)),
    });
  }
  push('customers', customers);

  // ─── Commandes ─────────────────────────────────────────────────────────────
  const pickupPool = products.filter((p) => p.fulfillment_policy === 'pickup_only' && !['plateau-20', 'buffet-bouchees'].includes(p.slug) && p.stock > 0);
  const sidePool = products.filter((p) => ['boissons', 'desserts'].includes(scenario.products.find((row) => row[0] === p.slug)[1]) && p.stock > 0);
  const deliveryPool = products.filter((p) => p.fulfillment_policy !== 'pickup_only' && p.stock > 0 && p.slug !== 'carte-cadeau-25');
  const orders = [];
  const orderItems = [];
  const deliveredOrders = [];
  const total = scenario.volumes.orders;
  for (let i = 0; i < total; i++) {
    const key = `order:${i + 1}`;
    // Les 14 premières font la journée « Aujourd'hui » / hier ; les autres s'étalent sur 90 jours, plus denses récemment.
    const day = i < 8 ? 0 : i < 14 ? -1 : -Math.min(scenario.volumes.orderDays, 2 + Math.floor(Math.pow(rng.next(), 1.4) * (scenario.volumes.orderDays - 2)));
    const delivery = i >= 8 && rng.chance(0.3);
    const assisted = i >= 8 && !delivery && rng.chance(0.08);
    const customer = rng.pick(customers);
    const lineCount = rng.int(1, 3);
    const chosen = new Map();
    const pool = delivery ? deliveryPool : pickupPool;
    for (let l = 0; l < lineCount; l++) {
      const product = l === 2 && !delivery ? rng.pick(sidePool) : rng.pick(pool);
      const base = product.slug.startsWith('plateau') ? 1 : rng.int(1, product.price < 6 ? 4 : 2);
      const quantity = Math.max(base, product.min_order_quantity);
      chosen.set(product.slug, (chosen.get(product.slug) ?? 0) + quantity);
    }
    const lines = [...chosen].map(([slug, quantity], index) => {
      const product = productBySlug.get(slug);
      return {
        id: id(`${key}:item:${index}`), tenant_id: tenantId, product_id: product.id, name: product.name,
        price: product.price, quantity, subtotal: round2(product.price * quantity), storage_type: product.storage_type,
      };
    });
    const subtotal = round2(lines.reduce((sum, line) => sum + line.subtotal, 0));
    const shipping = delivery ? scenario.tenant.flat_rate_amount : 0;

    let status; let paymentStatus = 'paid'; let paymentMethod = 'stripe';
    if (i < 8) status = ['new', 'new', 'new', 'preparing', 'preparing', 'ready_for_pickup', 'new', 'preparing'][i];
    else if (i < 14) status = rng.pick(['ready_for_pickup', 'delivered', 'delivered']);
    else status = rng.chance(0.04) ? 'cancelled' : 'delivered';
    if (i === 6) { paymentStatus = 'pending'; paymentMethod = 'external_link'; }
    else if (assisted) paymentMethod = 'manual';
    else if (!delivery && i >= 8) paymentMethod = rng.pick(['stripe', 'stripe', 'in_store', 'cash']);
    if (status === 'cancelled' && paymentMethod !== 'stripe') paymentStatus = 'pending';
    if (status === 'cancelled' && paymentMethod === 'stripe') paymentStatus = 'refunded';

    const createdAt = at(anchor, day, i < 8 ? 7 + i : rng.int(9, 19), rng.int(0, 59));
    const order = {
      id: id(key), tenant_id: tenantId, customer_id: customer.id,
      email: assisted && rng.chance(0.5) ? null : customer.email, full_name: customer.full_name,
      fulfillment_type: delivery ? 'delivery' : 'pickup',
      shipping_address: delivery ? { full_name: customer.full_name, line1: `${rng.int(1, 80)} rue de la Démo`, city: rng.pick(['Breuillet', 'Arpajon', 'Saint-Chéron', 'Évry-Courcouronnes', 'Massy']), postal_code: rng.pick(['91650', '91290', '91530', '91000', '91300']), country: 'FR', phone: customer.phone } : null,
      subtotal, shipping_cost: shipping, total: round2(subtotal + shipping),
      payment_method: paymentMethod, payment_status: paymentStatus,
      external_payment_label: paymentMethod === 'external_link' ? 'Lien de paiement (simulé)' : null,
      status, notes: `seed:${key}`, order_origin: assisted ? 'assisted' : 'storefront',
      sales_channel: assisted ? rng.pick(['whatsapp', 'phone']) : null,
      shipped_at: delivery && status === 'delivered' ? at(anchor, day + 1, 9) : null,
      created_at: createdAt, updated_at: createdAt, is_test: true,
    };
    orders.push(order);
    for (const line of lines) orderItems.push({ ...line, order_id: order.id });
    if (status === 'delivered' && order.email) deliveredOrders.push(order);
  }
  push('orders', orders);
  push('order_items', orderItems);

  // ─── Avis ─────────────────────────────────────────────────────────────────
  const REVIEW_TEXTS = ['Le yassa était parfait, comme à la maison.', 'Poulet braisé très tendre, retrait rapide.', 'Plateau parfait pour notre réunion de famille.',
    'Le bissap maison est excellent.', 'Très bon mafé, portions généreuses.', 'Commande prête à l’heure, accueil chaleureux.', 'L’attiéké poisson est une merveille.',
    'Service traiteur au top pour notre anniversaire.', 'Bonne cuisine, un peu d’attente le samedi.', 'Les alloco sont croustillants, on reviendra.'];
  const reviewed = rng.shuffle(deliveredOrders).slice(0, scenario.volumes.reviews);
  push('reviews', reviewed.map((order, index) => {
    const [first, last] = order.full_name.split(' ');
    const submitted = new Date(new Date(order.created_at).getTime() + 2 * 864e5).toISOString();
    return {
      id: id(`review:${index}`), tenant_id: tenantId, order_id: order.id, customer_id: order.customer_id, review_type: 'service',
      rating: index % 7 === 6 ? 3 : index % 3 === 0 ? 4 : 5, body: REVIEW_TEXTS[index % REVIEW_TEXTS.length],
      reviewer_display_name: `${first} ${last[0]}.`, verified_purchase: true, status: 'published', submitted_at: submitted, published_at: submitted,
    };
  }));

  // ─── Services : traiteur et location ───────────────────────────────────────
  const cateringId = id('service:traiteur');
  const rentalId = id('service:location-materiel');
  push('service_offerings', [
    { id: cateringId, tenant_id: tenantId, slug: 'traiteur', type: 'traiteur', title: scenario.services.catering.title, description: scenario.services.catering.description, cta_type: 'devis', active: true, sort_order: 0 },
    { id: rentalId, tenant_id: tenantId, slug: 'location-materiel', type: 'location_materiel', title: scenario.services.rental.title, description: scenario.services.rental.description, cta_type: 'reservation', active: true, sort_order: 1 },
  ]);
  const STEP = { nouveau: 0, a_contacter: 1, contacte: 2, devis_envoye: 3, accepte: 4, refuse: 4, clos: 5 };
  push('service_inquiries', scenario.inquiries.map(([key, name, inDays, guests, status, ageDays, message, note], index) => {
    const createdAt = at(anchor, -ageDays, 10 + (index % 8), 15);
    const step = STEP[status];
    return {
      id: id(`inquiry:${key}`), tenant_id: tenantId, service_offering_id: cateringId,
      customer_name: name, customer_email: `contact+${key}@example.com`, customer_phone: fictionPhone(500 + index),
      date_souhaitee: dateOnly(anchor, inDays), nombre_invites: guests, message, status, internal_notes: note,
      contacted_at: step >= 2 ? at(anchor, -Math.max(ageDays - 1, 0), 15) : null,
      quote_sent_at: step >= 3 && status !== 'clos' ? at(anchor, -Math.max(ageDays - 3, 0), 16) : null,
      accepted_at: status === 'accepte' ? at(anchor, -Math.max(ageDays - 8, 0), 11) : null,
      closed_at: ['refuse', 'clos'].includes(status) ? at(anchor, -Math.max(ageDays - 10, 0), 11) : null,
      created_at: createdAt, updated_at: createdAt,
    };
  }));

  const rentalItems = scenario.rentalItems.map(([name, category, price, stock], index) => ({
    id: id(`rental-item:${index}`), tenant_id: tenantId, service_offering_id: rentalId, name, category, price_per_unit: price, stock_quantity: stock, active: true, sort_order: index,
  }));
  push('rental_items', rentalItems);
  const rentalReservations = [];
  const rentalReservationItems = [];
  for (let r = 0; r < scenario.volumes.rentalReservations; r++) {
    const customer = rng.pick(customers);
    const picks = rng.shuffle(rentalItems).slice(0, rng.int(2, 3));
    const lines = picks.map((item, index) => ({ id: id(`rental-reservation:${r}:item:${index}`), rental_item_id: item.id, quantity: rng.int(2, 20), unit_price: item.price_per_unit }));
    const reservationId = id(`rental-reservation:${r}`);
    rentalReservations.push({
      id: reservationId, tenant_id: tenantId, service_offering_id: rentalId, customer_name: customer.full_name, customer_email: customer.email,
      customer_phone: customer.phone, pickup_date: dateOnly(anchor, r < 4 ? 3 + r * 5 : -12 - r * 4),
      amount_paid: round2(lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0)), status: 'confirmed',
      fulfillment_type: 'pickup', delivery_fee_status: 'not_applicable', created_at: at(anchor, -(r + 2) * 3, 14),
    });
    for (const line of lines) rentalReservationItems.push({ ...line, reservation_id: reservationId });
  }
  push('rental_reservations', rentalReservations);
  push('rental_reservation_items', rentalReservationItems);

  // ─── Soirées ───────────────────────────────────────────────────────────────
  const events = []; const ticketTypes = []; const reservations = []; const reservationItems = [];
  for (const [key, title, inDays, capacity, status, tickets, reservationCount] of scenario.events) {
    const eventId = id(`event:${key}`);
    const types = tickets.map(([label, price], index) => ({ id: id(`event:${key}:ticket:${index}`), tenant_id: tenantId, event_id: eventId, label, description: null, price, sort_order: index, active: true }));
    ticketTypes.push(...types);
    let booked = 0;
    for (let r = 0; r < reservationCount && booked < capacity; r++) {
      const customer = rng.pick(customers);
      const type = r % 4 === 3 && types[1] ? types[1] : types[0];
      const quantity = Math.min(rng.int(1, 3), capacity - booked);
      booked += quantity;
      const reservationId = id(`event:${key}:reservation:${r}`);
      reservations.push({
        id: reservationId, tenant_id: tenantId, event_id: eventId, customer_id: customer.id, customer_name: customer.full_name, customer_email: customer.email,
        customer_phone: customer.phone, amount_paid: round2(type.price * quantity), qr_token: stableHex(tenantId, `event:${key}:${r}`),
        quantity_total: quantity, quantity_remaining: inDays < 0 ? 0 : quantity, status: 'confirmed', source: 'online', payment_method: 'stripe',
        created_at: at(anchor, Math.min(inDays, 0) - rng.int(1, 20), rng.int(9, 21)), is_test: true,
      });
      reservationItems.push({ id: id(`event:${key}:reservation:${r}:item`), reservation_id: reservationId, ticket_type_id: type.id, quantity, unit_price: type.price });
    }
    events.push({
      id: eventId, tenant_id: tenantId, slug: key, title, subtitle: 'Événement de démonstration',
      description: `${title}. Événement fictif de la boutique de démonstration : places, prix et programme sont des exemples.`,
      date_start: at(anchor, inDays, 18, 30), location: scenario.tenant.click_collect_address, capacity_total: capacity, capacity_remaining: capacity - booked,
      status, show_remaining_places: true, booking_closes_at: inDays > 1 ? at(anchor, inDays - 1, 20) : null,
    });
  }
  push('events', events);
  push('event_ticket_types', ticketTypes);
  push('event_reservations', reservations);
  push('event_reservation_items', reservationItems);

  // ─── Nala ──────────────────────────────────────────────────────────────────
  push('tenant_knowledge_base', scenario.knowledge.map(([category, content], index) => ({
    id: id(`knowledge:${index}`), tenant_id: tenantId, category, content, source: `demo-seed:${scenario.key}`,
    reviewed_by: 'Lepefy (démo)', reviewed_at: at(anchor, -30), active: true,
  })));
  const QUESTIONS = [
    ['Qu’est-ce que vous me conseillez pour 6 personnes ?', 'recommendation', 'plateau-10'],
    ['Vous avez du yassa aujourd’hui ?', 'availability', 'yassa-poulet'],
    ['C’est quoi l’attiéké ?', 'product_information', 'attieke-poisson'],
    ['Vous livrez à Arpajon ?', 'delivery', null],
    ['Quels sont vos horaires ?', 'store_information', null],
    ['Je voudrais un devis pour un mariage', 'event_information', null],
    ['Le mafé est-il épicé ?', 'product_information', 'mafe-boeuf'],
    ['Vous faites du ndolé ?', 'availability', 'ndole'],
  ];
  const sessions = []; const interactions = [];
  for (let s = 0; s < scenario.volumes.nalaSessions; s++) {
    const sessionId = id(`nala:session:${s}`);
    const started = at(anchor, -rng.int(0, 29), rng.int(9, 21), rng.int(0, 59));
    sessions.push({ id: sessionId, tenant_id: tenantId, client_session_id: id(`nala:client:${s}`), locale: 'fr', device_type: rng.chance(0.7) ? 'mobile' : 'desktop', entry_path: '/', started_at: started, last_message_at: started, created_at: started });
    for (let m = 0; m < rng.int(1, 3); m++) {
      const [question, intent, productSlug] = rng.pick(QUESTIONS);
      const productId = productSlug ? productBySlug.get(productSlug)?.id ?? null : null;
      interactions.push({
        id: id(`nala:session:${s}:${m}`), tenant_id: tenantId, session_id: sessionId, message_text: question,
        reply_text: 'Réponse d’exemple de Nala (démonstration).', source_path: '/', ai_call_triggered: true, outcome: 'answered', intent,
        intent_confidence: 0.9, demand_status: productId ? 'fulfilled' : 'not_applicable', retrieval_quality: productId ? 'strong' : 'not_applicable',
        knowledge_status: 'sufficient', requested_product_text: null, semantic_enrichment_status: 'completed', semantic_enrichment_version: 'demo-seed',
        semantic_enriched_at: started, matched_product_ids: productId ? [productId] : null, created_at: started,
      });
    }
  }
  push('nala_sessions', sessions);
  push('nala_interactions', interactions);

  return { tables, productBySlug, gestion: buildGestionPlan(scenario, anchor) };
}

/** Gestion du commerce : exécutée par les RPC (mêmes contrôles que l'interface), clés de requête stables. */
function buildGestionPlan(scenario, anchor) {
  const day = (offset) => dateOnly(anchor, -offset);
  return {
    suppliers: scenario.suppliers.map(({ key, ...data }) => ({ requestKey: `demo-${key}`, data })),
    purchases: scenario.purchases.map(([key, supplier, status, ageDays, items, receipt, payments]) => ({
      requestKey: `demo-${key}`, supplierKey: `demo-${supplier}`, status, orderDate: day(ageDays), expectedDate: status === 'ordered' ? day(ageDays - 7) : null,
      items: items.map(([slug, description, quantity, cost]) => ({ slug, description, quantity, cost })),
      receipt: receipt ? { requestKey: `demo-${key}-rec`, mode: receipt, receivedAt: at(anchor, -Math.max(ageDays - 3, 0), 9) } : null,
      payments: payments.map(([offset, amount, method, verified], index) => ({ requestKey: `demo-${key}-pay-${index}`, paymentDate: day(offset), amount, method, verified })),
    })),
  };
}
