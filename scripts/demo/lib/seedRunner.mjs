import { buildPlan, demoTenantRow } from './buildPlan.mjs';
import { validatePlan } from './validatePlan.mjs';

/**
 * Écrit un scénario dans le tenant de démo. Deux modes :
 *
 * - seed (défaut) : complète le tenant existant (ou le crée). Idempotent : les
 *   lignes ont des identifiants stables (lib/random.mjs stableUuid), celles qui
 *   existent déjà sont sautées ; les RPC Gestion ont des clés de requête stables.
 * - reset : remise à zéro par ROTATION. Les tables append-only (audit_events,
 *   mouvements de stock, finances fournisseurs) interdisent toute suppression :
 *   on crée un nouveau tenant (slug temporaire), on le remplit, puis on archive
 *   l'ancien (inactif, slug renommé) et le nouveau prend le slug public.
 *   Refusé pendant une présentation (demo_begin_reset), sauf --force.
 *
 * Garde-fous : refuse tout tenant qui n'est pas is_demo + is_test ; le script
 * appelant vérifie en plus que la base est bien le projet Supabase de la démo.
 */

const NOOP = () => {};

async function existingIds(store, table, tenantId, column = 'tenant_id') {
  const rows = await store.select(table, 'id', { [column]: tenantId });
  return new Set((rows ?? []).map((row) => row.id));
}

const CHILD_TABLES = {
  order_items: { parentTable: 'orders', parentColumn: 'order_id' },
  event_reservation_items: { parentTable: 'event_reservations', parentColumn: 'reservation_id' },
  rental_reservation_items: { parentTable: 'rental_reservations', parentColumn: 'reservation_id' },
};
const KEYED_TABLES = { tenant_feature_flags: 'flag_key', tenant_feature_overrides: 'feature_key', tenant_feature_settings: 'feature_key' };

async function writeTables(store, tenantId, plan, log) {
  const counts = {};
  for (const { table, rows } of plan.tables) {
    let fresh;
    if (KEYED_TABLES[table]) {
      const key = KEYED_TABLES[table];
      const current = new Map(((await store.select(table, `${key},enabled`, { tenant_id: tenantId })) ?? []).map((row) => [row[key], row.enabled]));
      fresh = rows.filter((row) => !current.has(row[key]));
      // Lignes créées par défaut (triggers) mais désactivées : la démo les active.
      for (const row of rows) {
        if (current.has(row[key]) && current.get(row[key]) !== true) await store.update(table, { tenant_id: tenantId, [key]: row[key] }, { enabled: true });
      }
    } else if (CHILD_TABLES[table]) {
      // Lignes filles : présentes si leur parent existait déjà avant ce lancement.
      const { parentColumn } = CHILD_TABLES[table];
      const parents = plan.newParents?.[CHILD_TABLES[table].parentTable] ?? new Set();
      fresh = rows.filter((row) => parents.has(row[parentColumn]));
    } else {
      const existing = await existingIds(store, table, tenantId);
      fresh = rows.filter((row) => !existing.has(row.id));
      plan.newParents = plan.newParents ?? {};
      plan.newParents[table] = new Set(fresh.map((row) => row.id));
    }
    await store.insert(table, fresh);
    counts[table] = { planned: rows.length, inserted: fresh.length };
    log(`   ${table}: ${rows.length} prévues · ${fresh.length} insérées`);
  }
  return counts;
}

async function writeGestion(store, tenantId, gestion, productBySlug, log) {
  const supplierIds = new Map(((await store.select('suppliers', 'id,request_key', { tenant_id: tenantId })) ?? []).map((row) => [row.request_key, row.id]));
  for (const supplier of gestion.suppliers) {
    if (supplierIds.has(supplier.requestKey)) continue;
    const row = await store.rpc('create_supplier', { p_tenant_id: tenantId, p_data: supplier.data, p_request_key: supplier.requestKey, p_actor: null });
    supplierIds.set(supplier.requestKey, row?.out_supplier_id ?? `dry-${supplier.requestKey}`);
  }
  const purchaseIds = new Map(((await store.select('supplier_purchases', 'id,request_key', { tenant_id: tenantId })) ?? []).map((row) => [row.request_key, row.id]));
  const receiptKeys = new Set(((await store.select('supplier_receipts', 'request_key', { tenant_id: tenantId })) ?? []).map((row) => row.request_key));
  const payments = new Map(((await store.select('supplier_payments', 'id,request_key,status', { tenant_id: tenantId })) ?? []).map((row) => [row.request_key, row]));
  let created = 0;
  for (const purchase of gestion.purchases) {
    if (!purchaseIds.has(purchase.requestKey)) {
      const row = await store.rpc('save_supplier_purchase', {
        p_tenant_id: tenantId, p_purchase_id: null, p_request_key: purchase.requestKey, p_actor: null,
        p_data: { supplier_id: supplierIds.get(purchase.supplierKey), status: purchase.status, order_date: purchase.orderDate, expected_date: purchase.expectedDate, additional_costs: 0, supplier_reference: purchase.requestKey.toUpperCase() },
        p_items: purchase.items.map((item) => ({ product_id: item.slug ? productBySlug.get(item.slug)?.id ?? null : null, description: item.description, ordered_quantity: item.quantity, unit_cost: item.cost })),
      });
      purchaseIds.set(purchase.requestKey, row?.out_purchase_id ?? `dry-${purchase.requestKey}`);
      created++;
    }
    if (store.dryRun) continue;
    const purchaseId = purchaseIds.get(purchase.requestKey);
    if (purchase.receipt && !receiptKeys.has(purchase.receipt.requestKey)) {
      const items = ((await store.select('supplier_purchase_items', 'id,ordered_quantity,position', { tenant_id: tenantId, purchase_id: purchaseId })) ?? [])
        .sort((a, b) => a.position - b.position);
      // 'all' : tout est reçu ; 'partial' : la moitié de la première ligne seulement.
      const lines = purchase.receipt.mode === 'all'
        ? items.map((item) => ({ purchase_item_id: item.id, quantity: Number(item.ordered_quantity) }))
        : items.slice(0, 1).map((item) => ({ purchase_item_id: item.id, quantity: Math.max(1, Math.floor(Number(item.ordered_quantity) / 2)) }));
      if (lines.length) {
        await store.rpc('record_supplier_receipt', { p_tenant_id: tenantId, p_purchase_id: purchaseId, p_items: lines, p_received_at: purchase.receipt.receivedAt, p_notes: 'Réception de démonstration', p_request_key: purchase.receipt.requestKey, p_actor: null });
      }
    }
    for (const payment of purchase.payments) {
      let existing = payments.get(payment.requestKey);
      if (!existing) {
        const [financial] = await store.select('supplier_purchase_financials', 'total', { tenant_id: tenantId, purchase_id: purchaseId });
        const amount = payment.amount === 'all' ? Number(financial?.total ?? 0) : payment.amount;
        if (!(amount > 0)) continue;
        const row = await store.rpc('record_supplier_payment', {
          p_tenant_id: tenantId, p_request_key: payment.requestKey, p_actor: null,
          p_data: { supplier_id: supplierIds.get(purchase.supplierKey), amount, method: payment.method, payment_date: payment.paymentDate },
          p_allocations: [{ purchase_id: purchaseId, amount }],
        });
        existing = { id: row.out_payment_id, status: 'recorded' };
      }
      if (payment.verified && existing.status === 'recorded') await store.rpc('verify_supplier_payment', { p_tenant_id: tenantId, p_payment_id: existing.id, p_actor: null });
    }
  }
  log(`   gestion: ${gestion.suppliers.length} fournisseurs · ${gestion.purchases.length} achats (${created} créés)`);
}

/** Membres de l'équipe Lepefy qui présentent la démo : tenant_admin sur le tenant de démo. */
async function grantPresenters(store, tenantId, emails, log) {
  if (!emails.length) return;
  const [role] = await store.select('admin_roles', 'id', { code: 'tenant_admin' });
  for (const email of emails) {
    const [admin] = (await store.select('admin_users', 'id,role,email', { email })) ?? [];
    if (!admin) { log(`   ⚠ présentateur introuvable dans admin_users : ${email}`); continue; }
    if (admin.role === 'platform_owner') continue;
    const memberships = await store.select('admin_memberships', 'id,tenant_id', { user_id: admin.id });
    await store.update('admin_users', { id: admin.id }, { tenant_id: tenantId, role: 'tenant_admin', active: true });
    const current = (memberships ?? []).find((row) => row.tenant_id !== null);
    if (current) await store.update('admin_memberships', { id: current.id }, { tenant_id: tenantId, role_id: role.id, active: true });
    else await store.insert('admin_memberships', [{ user_id: admin.id, tenant_id: tenantId, role_id: role.id, active: true }]);
    log(`   présentateur ${email} → tenant_admin`);
  }
}

export async function loadDemoTenant(store, slug) {
  const [tenant] = (await store.select('tenants', 'id,slug,name,is_test,is_demo,active', { slug })) ?? [];
  if (tenant && !(tenant.is_demo === true && tenant.is_test === true)) {
    throw new Error(`Le tenant « ${slug} » existe mais n'est pas un tenant de démo (is_demo + is_test) : refusé.`);
  }
  return tenant ?? null;
}

async function createTenant(store, scenario, { slug, appUrl }) {
  const [created] = await store.insert('tenants', [demoTenantRow(scenario, { slug, appUrl })]);
  if (store.dryRun) return { id: '00000000-0000-4000-8000-000000000000', slug };
  return created;
}

export async function runSeed(store, scenario, options) {
  const { slug, appUrl = '', anchor = new Date(), presenters = [], log = NOOP } = options;
  let tenant = await loadDemoTenant(store, slug);
  if (!tenant) {
    log(`   création du tenant de démo « ${slug} »`);
    tenant = await createTenant(store, scenario, { slug, appUrl });
  }
  const plan = buildPlan(scenario, { tenantId: tenant.id, anchor, appUrl });
  const issues = validatePlan(scenario, plan);
  if (issues.length) throw new Error(`Plan incohérent :\n - ${issues.join('\n - ')}`);
  const counts = await writeTables(store, tenant.id, plan, log);
  await writeGestion(store, tenant.id, plan.gestion, plan.productBySlug, log);
  await grantPresenters(store, tenant.id, presenters, log);
  return { tenantId: tenant.id, counts };
}

export async function runReset(store, scenario, options) {
  const { slug, appUrl = '', anchor = new Date(), presenters = [], requestedBy = 'script', force = false, log = NOOP } = options;
  const previous = await loadDemoTenant(store, slug);
  // Sans tenant de démo actif, demo_begin_reset refuse (demo_disabled) : premier chargement = seed simple.
  if (!previous || !previous.active) return { ...(await runSeed(store, scenario, options)), resetId: null, archivedTenantId: null };

  const resetId = await store.rpc('demo_begin_reset', { p_scenario: scenario.key, p_requested_by: requestedBy, p_force: force });
  const stamp = anchor.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const nextSlug = `${slug}-next-${stamp}`;
  try {
    const next = await createTenant(store, scenario, { slug: nextSlug, appUrl });
    const plan = buildPlan(scenario, { tenantId: next.id, anchor, appUrl });
    const issues = validatePlan(scenario, plan);
    if (issues.length) throw new Error(`Plan incohérent :\n - ${issues.join('\n - ')}`);
    await writeTables(store, next.id, plan, log);
    await writeGestion(store, next.id, plan.gestion, plan.productBySlug, log);

    // Bascule : l'ancien libère le slug, le nouveau le prend.
    await store.update('tenants', { id: previous.id }, { slug: `${slug}-archive-${stamp}`, active: false });
    await store.update('tenants', { id: next.id }, { slug });
    await grantPresenters(store, next.id, presenters, log);

    // Visites ouvertes sur l'ancien tenant : comptes supprimés (cascade sur admin_users).
    const visitors = (await store.select('demo_visitor_accounts', 'user_id', { tenant_id: previous.id })) ?? [];
    for (const visitor of visitors) await store.deleteAuthUser(visitor.user_id).catch((error) => log(`   ⚠ visiteur non supprimé : ${error.message}`));

    await store.rpc('demo_finish_reset', { p_id: resetId, p_status: 'done', p_detail: `${scenario.key} v${scenario.version}`, p_old_tenant_id: previous.id, p_new_tenant_id: next.id });
    return { tenantId: next.id, archivedTenantId: previous.id, resetId };
  } catch (error) {
    if (resetId) await store.rpc('demo_finish_reset', { p_id: resetId, p_status: 'failed', p_detail: String(error.message).slice(0, 1900), p_old_tenant_id: previous.id, p_new_tenant_id: null }).catch(() => undefined);
    throw error;
  }
}
