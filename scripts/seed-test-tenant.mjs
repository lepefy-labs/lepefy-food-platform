/**
 * scripts/seed-test-tenant.mjs
 * Lepefy Food — Seed idempotente del tenant di test (migration 138)
 * Usa fetch nativo per Supabase REST API — nessuna dipendenza.
 *
 * Crea per il tenant TEST_TENANT_SLUG (default lepefy-test):
 *   - 3 categorie, 12 prodotti;
 *   - 1 metodo di pagamento esterno (link fittizio);
 *   - 4 ordini finti (is_test = true, email @example.com, nessun pagamento reale).
 *
 * Sicurezza: si ferma se il tenant non esiste o se tenants.is_test non è true.
 * Non invia alcuna notifica (scrive direttamente in DB, nessuna API dell'app).
 *
 * Idempotenza: le righe esistenti vengono lette filtrando SOLO su tenant_id e lo
 * skip è fatto in JavaScript dopo la fetch (mai filtri PostgREST su jsonb).
 *   SKIP_EXISTING=true  (default) → le righe già presenti vengono saltate;
 *   SKIP_EXISTING=false → categorie/prodotti/metodo esistenti vengono
 *                         riallineati ai valori del seed. Gli ordini esistenti
 *                         sono sempre saltati (mai duplicati).
 *   DRY_RUN=true        → nessuna scrittura, solo log.
 * Chiave di seed: categorie/prodotti per slug, metodo per label, ordini per
 * notes = "seed:<n>".
 */

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TENANT_SLUG   = process.env.TEST_TENANT_SLUG || 'lepefy-test';
const SKIP_EXISTING = process.env.SKIP_EXISTING !== 'false';
const DRY_RUN       = process.env.DRY_RUN === 'true';

const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  .filter((k) => !process.env[k]);
if (missing.length) {
  console.error('❌ Env vars mancanti:', missing.join(', '));
  process.exit(1);
}

// ─── Dati di seed ─────────────────────────────────────────────────────────────

const CATEGORIES = [
  { slug: 'epicerie', name: 'Épicerie', position: 0 },
  { slug: 'boissons', name: 'Boissons', position: 1 },
  { slug: 'surgeles', name: 'Surgelés', position: 2 },
];

const PRODUCTS = [
  { slug: 'test-farine-manioc-1kg',   category: 'epicerie', name: 'Farine de manioc 1 kg',     price: 4.50, weight_grams: 1000 },
  { slug: 'test-riz-parfume-5kg',     category: 'epicerie', name: 'Riz parfumé 5 kg',          price: 12.90, weight_grams: 5000 },
  { slug: 'test-huile-palme-1l',      category: 'epicerie', name: 'Huile de palme 1 L',        price: 6.20, weight_grams: 950 },
  { slug: 'test-attieke-500g',        category: 'epicerie', name: 'Attiéké 500 g',             price: 3.80, weight_grams: 500 },
  { slug: 'test-piment-seche-100g',   category: 'epicerie', name: 'Piment séché 100 g',        price: 2.40, weight_grams: 100 },
  { slug: 'test-bouillon-cubes',      category: 'epicerie', name: 'Bouillon en cubes x60',     price: 3.10, weight_grams: 600 },
  { slug: 'test-jus-bissap-1l',       category: 'boissons', name: 'Jus de bissap 1 L',         price: 3.50, weight_grams: 1100 },
  { slug: 'test-jus-gingembre-1l',    category: 'boissons', name: 'Jus de gingembre 1 L',      price: 3.50, weight_grams: 1100 },
  { slug: 'test-malta-33cl',          category: 'boissons', name: 'Boisson maltée 33 cl',      price: 1.60, weight_grams: 380 },
  { slug: 'test-poisson-fume-500g',   category: 'surgeles', name: 'Poisson fumé 500 g',        price: 9.90, weight_grams: 500 },
  { slug: 'test-feuilles-manioc-1kg', category: 'surgeles', name: 'Feuilles de manioc 1 kg',   price: 5.40, weight_grams: 1000 },
  { slug: 'test-banane-plantain-1kg', category: 'surgeles', name: 'Banane plantain 1 kg',      price: 4.20, weight_grams: 1000 },
];

const PAYMENT_METHOD = {
  method: 'other',
  label: 'Paiement externe (test)',
  value: 'https://example.com/paiement-test',
  sort_order: 0,
  active: true,
};

const ORDERS = [
  { key: 'seed:1', full_name: 'Client Test Un',     status: 'new',              payment_status: 'pending', payment_method: 'external_link', fulfillment_type: 'delivery', items: [['test-riz-parfume-5kg', 1], ['test-huile-palme-1l', 2]] },
  { key: 'seed:2', full_name: 'Client Test Deux',   status: 'preparing',        payment_status: 'paid',    payment_method: 'manual',        fulfillment_type: 'pickup',   items: [['test-attieke-500g', 3], ['test-jus-bissap-1l', 2]] },
  { key: 'seed:3', full_name: 'Client Test Trois',  status: 'ready_for_pickup', payment_status: 'paid',    payment_method: 'cash',          fulfillment_type: 'pickup',   items: [['test-malta-33cl', 12]] },
  { key: 'seed:4', full_name: 'Client Test Quatre', status: 'cancelled',        payment_status: 'pending', payment_method: 'external_link', fulfillment_type: 'delivery', items: [['test-poisson-fume-500g', 1]] },
];

// ─── Supabase REST helpers (fetch puro, no SDK) ───────────────────────────────

const SB_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { ...SB_HEADERS, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbInsert(table, rows) {
  if (!rows.length) return [];
  if (DRY_RUN) return rows.map((row, i) => ({ ...row, id: row.id ?? `dry-run-${table}-${i}` }));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase POST ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbPatchById(table, id, patch) {
  if (DRY_RUN) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${table}/${id}: ${res.status} ${await res.text()}`);
}

function logCounts(label, { read, toInsert, inserted, updated = 0 }) {
  console.log(`   ${label}: letti ${read} · da inserire dopo lo skip ${toInsert} · inseriti ${inserted} · aggiornati ${updated}`);
}

const round2 = (n) => Math.round(n * 100) / 100;

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function loadTenant() {
  const rows = await sbGet(`tenants?select=id,slug,name,is_test&slug=eq.${encodeURIComponent(TENANT_SLUG)}`);
  const tenant = rows[0];
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" non trovato: applicare prima la migration 138.`);
  if (tenant.is_test !== true) throw new Error(`Tenant "${TENANT_SLUG}" non è un tenant di test (is_test != true): seed rifiutato.`);
  return tenant;
}

async function seedCategories(tenantId) {
  const existing = await sbGet(`categories?select=id,slug,name,position&tenant_id=eq.${tenantId}`);
  const bySlug = new Map(existing.map((row) => [row.slug, row]));
  const toInsert = CATEGORIES.filter((c) => !bySlug.has(c.slug));
  let updated = 0;
  if (!SKIP_EXISTING) {
    for (const c of CATEGORIES.filter((c) => bySlug.has(c.slug))) {
      await sbPatchById('categories', bySlug.get(c.slug).id, { name: c.name, position: c.position });
      updated++;
    }
  }
  const inserted = await sbInsert('categories', toInsert.map((c) => ({ ...c, tenant_id: tenantId })));
  logCounts('categorie', { read: existing.length, toInsert: toInsert.length, inserted: inserted.length, updated });
  for (const row of inserted) bySlug.set(row.slug, row);
  return bySlug;
}

async function seedProducts(tenantId, categoriesBySlug) {
  const existing = await sbGet(`products?select=id,slug,name,price&tenant_id=eq.${tenantId}`);
  const bySlug = new Map(existing.map((row) => [row.slug, row]));
  const toRow = (p, i) => ({
    tenant_id: tenantId,
    category_id: categoriesBySlug.get(p.category)?.id ?? null,
    slug: p.slug,
    name: p.name,
    description: `${p.name}. Produit fictif de la boutique de test.`,
    price: p.price,
    weight_grams: p.weight_grams,
    stock: 100,
    active: true,
    featured: i < 4,
    position: i,
  });
  const toInsert = PRODUCTS.map((p, i) => [p, i]).filter(([p]) => !bySlug.has(p.slug));
  let updated = 0;
  if (!SKIP_EXISTING) {
    for (const [p, i] of PRODUCTS.map((p, i) => [p, i]).filter(([p]) => bySlug.has(p.slug))) {
      const { tenant_id: _tenantId, slug: _slug, ...patch } = toRow(p, i);
      await sbPatchById('products', bySlug.get(p.slug).id, patch);
      updated++;
    }
  }
  const inserted = await sbInsert('products', toInsert.map(([p, i]) => toRow(p, i)));
  logCounts('prodotti', { read: existing.length, toInsert: toInsert.length, inserted: inserted.length, updated });
  for (const row of inserted) bySlug.set(row.slug, row);
  return bySlug;
}

async function seedPaymentMethod(tenantId) {
  const existing = await sbGet(`tenant_payment_methods?select=id,label&tenant_id=eq.${tenantId}`);
  const match = existing.find((row) => row.label === PAYMENT_METHOD.label);
  let updated = 0;
  if (match && !SKIP_EXISTING) {
    await sbPatchById('tenant_payment_methods', match.id, PAYMENT_METHOD);
    updated = 1;
  }
  const inserted = match ? [] : await sbInsert('tenant_payment_methods', [{ ...PAYMENT_METHOD, tenant_id: tenantId }]);
  logCounts('metodi di pagamento', { read: existing.length, toInsert: match ? 0 : 1, inserted: inserted.length, updated });
}

async function seedOrders(tenantId, productsBySlug) {
  const existing = await sbGet(`orders?select=id,notes&tenant_id=eq.${tenantId}`);
  const existingKeys = new Set(existing.map((row) => row.notes).filter(Boolean));
  // Gli ordini esistenti non vengono mai riscritti né duplicati, qualunque sia SKIP_EXISTING.
  const toInsert = ORDERS.filter((o) => !existingKeys.has(o.key));
  let inserted = 0;
  for (const [index, order] of toInsert.entries()) {
    const lines = order.items.map(([slug, quantity]) => {
      const product = productsBySlug.get(slug);
      if (!product) throw new Error(`Prodotto ${slug} mancante per l'ordine ${order.key}`);
      const price = Number(product.price ?? PRODUCTS.find((p) => p.slug === slug).price);
      return { product_id: product.id, name: product.name, price, quantity, subtotal: round2(price * quantity) };
    });
    const subtotal = round2(lines.reduce((sum, line) => sum + line.subtotal, 0));
    const shippingCost = order.fulfillment_type === 'delivery' ? 5.90 : 0;
    const [created] = await sbInsert('orders', [{
      tenant_id: tenantId,
      email: `test+${order.key.replace(':', '-')}@example.com`,
      full_name: order.full_name,
      fulfillment_type: order.fulfillment_type,
      shipping_address: order.fulfillment_type === 'delivery'
        ? { line1: '1 rue du Test', city: 'Milano', postal_code: '20100', country: 'IT' }
        : null,
      subtotal,
      shipping_cost: shippingCost,
      total: round2(subtotal + shippingCost),
      payment_method: order.payment_method,
      payment_status: order.payment_status,
      status: order.status,
      notes: order.key,
      is_test: true,
      // > 24 h: fuori dalla finestra di tests/e2e/scripts/cleanup-test-data.ts,
      // che cancella gli ordini is_test delle ultime 24 h di tutti i tenant.
      created_at: new Date(Date.now() - (index + 2) * 864e5).toISOString(),
    }]);
    await sbInsert('order_items', lines.map((line) => ({ ...line, order_id: created.id, tenant_id: tenantId })));
    inserted++;
  }
  logCounts('ordini', { read: existing.length, toInsert: toInsert.length, inserted });
}

async function main() {
  console.log(`🌱 Seed tenant di test "${TENANT_SLUG}" — SKIP_EXISTING=${SKIP_EXISTING} DRY_RUN=${DRY_RUN}`);
  const tenant = await loadTenant();
  console.log(`   tenant: ${tenant.name} (${tenant.id})`);
  const categories = await seedCategories(tenant.id);
  const products = await seedProducts(tenant.id, categories);
  await seedPaymentMethod(tenant.id);
  await seedOrders(tenant.id, products);
  console.log(DRY_RUN ? '✅ Dry-run completato (nessuna scrittura).' : '✅ Seed completato.');
}

main().catch((error) => {
  console.error('❌', error instanceof Error ? error.message : error);
  process.exit(1);
});
