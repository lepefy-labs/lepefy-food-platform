/**
 * scripts/seed-test-tenant-gestion.mjs
 * Lepefy Food — Seed idempotente di "Gestion du commerce" (migration 139) sul tenant di test.
 * Usa fetch nativo verso Supabase REST/RPC — nessuna dipendenza.
 *
 * Prerequisiti: migration 139 applicata e seed catalogo eseguito
 * (scripts/seed-test-tenant.mjs, prodotti test-*).
 *
 * Crea per TEST_TENANT_SLUG (default lepefy-test), passando SEMPRE dalle RPC
 * (stesse regole, stessi controlli, stesso audit dell'interfaccia):
 *   - 4 fornitori;
 *   - 6 acquisti: bozza, ordinato, ricevuto in parte, ricevuto non pagato,
 *     pagato in parte (esempio 2 400 € = 600 + 500 a un terzo + 300, resta 1 000 €),
 *     pagato interamente;
 *   - ricezioni parziali e complete (movimenti di inventario, stock incrementato);
 *   - pagamenti a rate, un pagamento a un terzo, un pagamento da verificare.
 *
 * Sicurezza: si ferma se il tenant non esiste o se tenants.is_test non è true.
 * Idempotenza: request key deterministiche (seed-gestion-…). Le righe esistenti
 * vengono lette filtrando SOLO su tenant_id e saltate in JavaScript; in ogni caso
 * le RPC sono idempotenti sulla stessa chiave (nessun doppio stock, nessun doppio pagamento).
 *   DRY_RUN=true → nessuna scrittura, solo il piano.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TENANT_SLUG  = process.env.TEST_TENANT_SLUG || 'lepefy-test';
const DRY_RUN      = process.env.DRY_RUN === 'true';

const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error('❌ Env vars mancanti:', missing.join(', '));
  process.exit(1);
}

const SB_HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { ...SB_HEADERS, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Supabase GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function rpc(fn, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: SB_HEADERS, body: JSON.stringify(params) });
  if (!res.ok) throw new Error(`RPC ${fn}: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// ─── Dati ─────────────────────────────────────────────────────────────────────

const SUPPLIERS = [
  { key: 'seed-gestion-sup-afro', data: { name: 'Afro Distribution', contact_name: 'Awa Diallo', email: 'contact@afro-distribution.example', country: 'IT', notes: 'Fournisseur principal (épicerie).' } },
  { key: 'seed-gestion-sup-dakar', data: { name: 'Dakar Import', contact_name: 'Moussa Ndiaye', phone: '+221 77 000 00 00', country: 'SN' } },
  { key: 'seed-gestion-sup-boissons', data: { name: 'Boissons du Monde', email: 'commandes@boissons.example', country: 'FR' } },
  { key: 'seed-gestion-sup-milano', data: { name: 'Grossista Milano', legal_name: 'Grossista Milano Srl', country: 'IT' } },
];

// items: [slug catalogo | null, descrizione, quantità, costo unitario]
const PURCHASES = [
  { key: 'seed-gestion-ach-1-draft', supplier: 'seed-gestion-sup-boissons', status: 'draft', order_date: daysAgo(2),
    items: [['test-jus-bissap-1l', null, 24, 1.8], ['test-malta-33cl', null, 48, 0.7]] },
  { key: 'seed-gestion-ach-2-ordered', supplier: 'seed-gestion-sup-dakar', status: 'ordered', order_date: daysAgo(6), expected_date: daysAgo(-5),
    items: [['test-attieke-500g', null, 40, 1.9], [null, 'Sacs d\'emballage 5 kg', 100, 0.15]] },
  { key: 'seed-gestion-ach-3-partial', supplier: 'seed-gestion-sup-afro', status: 'ordered', order_date: daysAgo(15), expected_date: daysAgo(3),
    items: [['test-farine-manioc-1kg', null, 30, 2.2], ['test-poisson-fume-500g', null, 20, 5.5]] },
  { key: 'seed-gestion-ach-4-received', supplier: 'seed-gestion-sup-milano', status: 'ordered', order_date: daysAgo(20),
    items: [['test-bouillon-cubes', null, 50, 1.6]] },
  // Esempio documentato: 2 400 € (1 500 + 800 + 100 di spese) = 600 + 500 terzo + 300, resta 1 000 €.
  { key: 'seed-gestion-ach-5-2400', supplier: 'seed-gestion-sup-afro', status: 'ordered', order_date: daysAgo(30), additional_costs: 100,
    items: [['test-riz-parfume-5kg', null, 10, 150], ['test-huile-palme-1l', null, 10, 80]] },
  { key: 'seed-gestion-ach-6-paid', supplier: 'seed-gestion-sup-dakar', status: 'ordered', order_date: daysAgo(40),
    items: [['test-piment-seche-100g', null, 60, 1.1]] },
];

// Ricezioni: [purchaseKey, requestKey, { indice riga: quantità } | 'all']
const RECEIPTS = [
  ['seed-gestion-ach-3-partial', 'seed-gestion-rec-3a', { 0: 30, 1: 8 }],
  ['seed-gestion-ach-4-received', 'seed-gestion-rec-4', 'all'],
  ['seed-gestion-ach-5-2400', 'seed-gestion-rec-5', 'all'],
  ['seed-gestion-ach-6-paid', 'seed-gestion-rec-6', 'all'],
];

// Pagamenti: [requestKey, supplierKey, payload, [[purchaseKey, amount]], verify]
const PAYMENTS = [
  ['seed-gestion-pay-5a', 'seed-gestion-sup-afro', { amount: 600, method: 'bank_transfer', payment_date: daysAgo(18), external_reference: 'VIR-0001' }, [['seed-gestion-ach-5-2400', 600]], true],
  ['seed-gestion-pay-5b', 'seed-gestion-sup-afro', { amount: 500, method: 'bank_transfer', payment_date: daysAgo(11), beneficiary_type: 'third_party',
    beneficiary_name: 'Transitaire Dakar Port', beneficiary_reference: 'SN08 0000 0000 0000', supplier_instruction_note: 'Instruction WhatsApp du fournisseur : payer directement le transitaire.' },
    [['seed-gestion-ach-5-2400', 500]], true],
  ['seed-gestion-pay-5c', 'seed-gestion-sup-afro', { amount: 300, method: 'cash', payment_date: daysAgo(7), payer_account: 'Caisse magasin' }, [['seed-gestion-ach-5-2400', 300]], true],
  ['seed-gestion-pay-6', 'seed-gestion-sup-dakar', { amount: 66, method: 'card', payment_date: daysAgo(35) }, [['seed-gestion-ach-6-paid', 66]], true],
  ['seed-gestion-pay-3', 'seed-gestion-sup-afro', { amount: 50, method: 'bank_transfer', payment_date: daysAgo(1) }, [['seed-gestion-ach-3-partial', 50]], false],
];

// ─── Seed ─────────────────────────────────────────────────────────────────────

function logCounts(label, read, toCreate, created) {
  console.log(`   ${label}: letti ${read} · da creare dopo lo skip ${toCreate} · creati ${created}`);
}

async function main() {
  console.log(`🌱 Seed Gestion "${TENANT_SLUG}" — DRY_RUN=${DRY_RUN}`);
  const [tenant] = await sbGet(`tenants?select=id,name,is_test&slug=eq.${encodeURIComponent(TENANT_SLUG)}`);
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" non trovato.`);
  if (tenant.is_test !== true) throw new Error(`Tenant "${TENANT_SLUG}" non è un tenant di test (is_test != true): seed rifiutato.`);
  const T = tenant.id;

  const products = await sbGet(`products?select=id,slug&tenant_id=eq.${T}`);
  const productBySlug = new Map(products.map((p) => [p.slug, p.id]));
  const missingProducts = PURCHASES.flatMap((p) => p.items.map((i) => i[0])).filter((slug) => slug && !productBySlug.has(slug));
  if (missingProducts.length) throw new Error(`Prodotti mancanti (lanciare prima seed-test-tenant.mjs): ${[...new Set(missingProducts)].join(', ')}`);

  // Fornitori
  const existingSuppliers = await sbGet(`suppliers?select=id,request_key&tenant_id=eq.${T}`);
  const supplierByKey = new Map(existingSuppliers.filter((s) => s.request_key).map((s) => [s.request_key, s.id]));
  const newSuppliers = SUPPLIERS.filter((s) => !supplierByKey.has(s.key));
  let created = 0;
  for (const supplier of newSuppliers) {
    if (DRY_RUN) { supplierByKey.set(supplier.key, `dry-${supplier.key}`); continue; }
    const row = await rpc('create_supplier', { p_tenant_id: T, p_data: supplier.data, p_request_key: supplier.key, p_actor: null });
    supplierByKey.set(supplier.key, row.out_supplier_id);
    if (row.out_created) created++;
  }
  logCounts('fornitori', existingSuppliers.length, newSuppliers.length, created);

  // Acquisti
  const existingPurchases = await sbGet(`supplier_purchases?select=id,request_key,status&tenant_id=eq.${T}`);
  const purchaseByKey = new Map(existingPurchases.filter((p) => p.request_key).map((p) => [p.request_key, p.id]));
  const newPurchases = PURCHASES.filter((p) => !purchaseByKey.has(p.key));
  created = 0;
  for (const purchase of newPurchases) {
    if (DRY_RUN) { purchaseByKey.set(purchase.key, `dry-${purchase.key}`); continue; }
    const row = await rpc('save_supplier_purchase', {
      p_tenant_id: T, p_purchase_id: null, p_request_key: purchase.key, p_actor: null,
      p_data: {
        supplier_id: supplierByKey.get(purchase.supplier), status: purchase.status, order_date: purchase.order_date,
        expected_date: purchase.expected_date ?? null, additional_costs: purchase.additional_costs ?? 0,
        supplier_reference: `FACT-${purchase.key.split('-')[3]}`,
      },
      p_items: purchase.items.map(([slug, description, quantity, cost]) => ({
        product_id: slug ? productBySlug.get(slug) : null, description, ordered_quantity: quantity, unit_cost: cost,
      })),
    });
    purchaseByKey.set(purchase.key, row.out_purchase_id);
    if (row.out_created) created++;
  }
  logCounts('acquisti', existingPurchases.length, newPurchases.length, created);

  // Ricezioni
  const existingReceipts = await sbGet(`supplier_receipts?select=request_key&tenant_id=eq.${T}`);
  const receiptKeys = new Set(existingReceipts.map((r) => r.request_key));
  const newReceipts = RECEIPTS.filter(([, key]) => !receiptKeys.has(key));
  created = 0;
  for (const [purchaseKey, key, plan] of newReceipts) {
    if (DRY_RUN) continue;
    const purchaseId = purchaseByKey.get(purchaseKey);
    const items = await sbGet(`supplier_purchase_items?select=id,ordered_quantity,position&tenant_id=eq.${T}&purchase_id=eq.${purchaseId}&order=position`);
    const lines = items
      .map((item, index) => ({ purchase_item_id: item.id, quantity: plan === 'all' ? item.ordered_quantity : plan[index] ?? 0 }))
      .filter((line) => line.quantity > 0);
    const row = await rpc('record_supplier_receipt', {
      p_tenant_id: T, p_purchase_id: purchaseId, p_items: lines, p_received_at: new Date(Date.now() - 2 * 864e5).toISOString(),
      p_notes: 'Seed de test', p_request_key: key, p_actor: null,
    });
    if (row.out_created) created++;
  }
  logCounts('ricezioni', existingReceipts.length, newReceipts.length, created);

  // Pagamenti (+ affectations) e verifiche
  const existingPayments = await sbGet(`supplier_payments?select=id,request_key,status&tenant_id=eq.${T}`);
  const paymentByKey = new Map(existingPayments.map((p) => [p.request_key, p]));
  const newPayments = PAYMENTS.filter(([key]) => !paymentByKey.has(key));
  created = 0;
  let verified = 0;
  for (const [key, supplierKey, payload, allocations, verify] of PAYMENTS) {
    if (DRY_RUN) continue;
    let payment = paymentByKey.get(key);
    if (!payment) {
      const row = await rpc('record_supplier_payment', {
        p_tenant_id: T, p_request_key: key, p_actor: null,
        p_data: { ...payload, supplier_id: supplierByKey.get(supplierKey) },
        p_allocations: allocations.map(([purchaseKey, amount]) => ({ purchase_id: purchaseByKey.get(purchaseKey), amount })),
      });
      payment = { id: row.out_payment_id, status: 'recorded' };
      if (row.out_created) created++;
    }
    if (verify && payment.status === 'recorded') {
      const row = await rpc('verify_supplier_payment', { p_tenant_id: T, p_payment_id: payment.id, p_actor: null });
      if (row.out_changed) verified++;
    }
  }
  logCounts('pagamenti', existingPayments.length, newPayments.length, created);
  console.log(`   pagamenti verificati in questo lancio: ${verified}`);

  if (!DRY_RUN) {
    const [example] = await sbGet(`supplier_purchase_financials?select=total,paid_verified,outstanding&tenant_id=eq.${T}&purchase_id=eq.${purchaseByKey.get('seed-gestion-ach-5-2400')}`);
    console.log(`   esempio 2 400 €: totale ${example?.total} · pagato verificato ${example?.paid_verified} · resta ${example?.outstanding}`);
  }
  console.log(DRY_RUN ? '✅ Dry-run completato (nessuna scrittura).' : '✅ Seed Gestion completato.');
}

main().catch((error) => {
  console.error('❌', error instanceof Error ? error.message : error);
  process.exit(1);
});
