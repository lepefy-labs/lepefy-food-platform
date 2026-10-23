/**
 * scripts/demo/build-seed-sql.mjs — le seed de la démo sous forme de SQL, pour
 * le premier chargement sans clé service-role (éditeur SQL Supabase ou psql).
 *
 *   node scripts/demo/build-seed-sql.mjs --scenario traiteur-africain --slug lepefy-demo --app-url https://demo.lepefy.com > seed.sql
 *
 * Même plan que seed-demo.mjs (lib/buildPlan.mjs, validé par lib/validatePlan.mjs),
 * mêmes RPC Gestion. Refuse (exception SQL) si le slug existe déjà : pour
 * compléter ou remettre à zéro un tenant existant, utiliser seed-demo.mjs.
 * Sortie : une suite d'instructions séparées par la ligne `-- ─── lot`, chacune
 * exécutable seule et dans l'ordre (l'éditeur SQL limite la taille d'une requête).
 */
import { randomUUID } from 'node:crypto';
import { buildPlan, demoTenantRow } from './lib/buildPlan.mjs';
import { validatePlan } from './lib/validatePlan.mjs';

export const BATCH_SEPARATOR = '-- ─── lot';

const literal = (value) => `$lepefy$${value}$lepefy$`;
const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;
const text = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`);

/** Tables à clé (tenant, clé) : des lignes par défaut peuvent exister (triggers) → activées. */
const KEYED = { tenant_feature_flags: 'flag_key', tenant_feature_overrides: 'feature_key', tenant_feature_settings: 'feature_key' };

function insertRows(table, rows) {
  const columns = Object.keys(rows[0]).map((column) => `"${column}"`).join(', ');
  const conflict = KEYED[table] ? `\non conflict (tenant_id, ${KEYED[table]}) do update set enabled = excluded.enabled` : '';
  return `insert into public."${table}" (${columns})\nselect ${columns} from json_populate_recordset(null::public."${table}", ${literal(JSON.stringify(rows))}::json)${conflict};`;
}

export function buildSeedSql(scenario, { slug, appUrl = '', anchor = new Date(), tenantId = randomUUID() }) {
  const plan = buildPlan(scenario, { tenantId, anchor, appUrl });
  const issues = validatePlan(scenario, plan);
  if (issues.length) throw new Error(`Plan incohérent :\n - ${issues.join('\n - ')}`);
  const T = text(tenantId);
  const statements = [];

  statements.push(`do $guard$ begin
  if exists (select 1 from public.tenants where slug = ${text(slug)}) then raise exception 'demo_tenant_exists: %', ${text(slug)}; end if;
end $guard$;
${insertRows('tenants', [{ id: tenantId, ...demoTenantRow(scenario, { slug, appUrl }) }])}`);

  for (const { table, rows } of plan.tables) {
    // Lots de 200 lignes : une requête de l'éditeur reste sous sa limite de taille.
    for (let i = 0; i < rows.length; i += 200) statements.push(insertRows(table, rows.slice(i, i + 200)));
  }

  const { suppliers, purchases } = plan.gestion;
  const supplierId = (key) => `(select id from public.suppliers where tenant_id = ${T} and request_key = ${text(key)})`;
  const purchaseId = (key) => `(select id from public.supplier_purchases where tenant_id = ${T} and request_key = ${text(key)})`;
  const gestion = [];
  for (const supplier of suppliers) {
    gestion.push(`select * from public.create_supplier(p_tenant_id => ${T}::uuid, p_data => ${json(supplier.data)}, p_request_key => ${text(supplier.requestKey)}, p_actor => null::uuid);`);
  }
  for (const purchase of purchases) {
    const items = purchase.items.map((item) => ({
      product_id: item.slug ? plan.productBySlug.get(item.slug)?.id ?? null : null,
      description: item.description, ordered_quantity: item.quantity, unit_cost: item.cost,
    }));
    gestion.push(`select * from public.save_supplier_purchase(p_tenant_id => ${T}::uuid, p_purchase_id => null::uuid, p_data => jsonb_build_object(
  'supplier_id', ${supplierId(purchase.supplierKey)}, 'status', ${text(purchase.status)}, 'order_date', ${text(purchase.orderDate)},
  'expected_date', ${text(purchase.expectedDate)}, 'additional_costs', 0, 'supplier_reference', ${text(purchase.requestKey.toUpperCase())}),
  p_items => ${json(items)}, p_request_key => ${text(purchase.requestKey)}, p_actor => null::uuid);`);
    if (purchase.receipt) {
      const quantity = purchase.receipt.mode === 'all' ? 'i.ordered_quantity' : 'greatest(1, floor(i.ordered_quantity / 2))';
      const filter = purchase.receipt.mode === 'all' ? '' : `and i.position = (select min(position) from public.supplier_purchase_items where purchase_id = ${purchaseId(purchase.requestKey)})`;
      gestion.push(`select * from public.record_supplier_receipt(p_tenant_id => ${T}::uuid, p_purchase_id => ${purchaseId(purchase.requestKey)},
  p_items => (select jsonb_agg(jsonb_build_object('purchase_item_id', i.id, 'quantity', ${quantity}) order by i.position)
     from public.supplier_purchase_items i where i.tenant_id = ${T} and i.purchase_id = ${purchaseId(purchase.requestKey)} ${filter}),
  p_received_at => ${text(purchase.receipt.receivedAt)}::timestamptz, p_notes => 'Réception de démonstration', p_request_key => ${text(purchase.receipt.requestKey)}, p_actor => null::uuid);`);
    }
    for (const payment of purchase.payments) {
      const amount = payment.amount === 'all'
        ? `(select total from public.supplier_purchase_financials where tenant_id = ${T} and purchase_id = ${purchaseId(purchase.requestKey)})`
        : String(payment.amount);
      gestion.push(`select * from public.record_supplier_payment(p_tenant_id => ${T}::uuid, p_data => jsonb_build_object(
  'supplier_id', ${supplierId(purchase.supplierKey)}, 'amount', ${amount}, 'method', ${text(payment.method)}, 'payment_date', ${text(payment.paymentDate)}),
  p_allocations => jsonb_build_array(jsonb_build_object('purchase_id', ${purchaseId(purchase.requestKey)}, 'amount', ${amount})), p_request_key => ${text(payment.requestKey)}, p_actor => null::uuid);`);
      if (payment.verified) {
        gestion.push(`select * from public.verify_supplier_payment(p_tenant_id => ${T}::uuid, p_payment_id => (select id from public.supplier_payments where tenant_id = ${T} and request_key = ${text(payment.requestKey)}), p_actor => null::uuid);`);
      }
    }
  }
  statements.push(gestion.join('\n'));
  return { tenantId, sql: statements.join(`\n${BATCH_SEPARATOR}\n`) };
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

if (process.argv[1]?.endsWith('build-seed-sql.mjs')) {
  const key = arg('scenario');
  const slug = arg('slug');
  if (!key || !slug) { console.error('Usage : --scenario <clé> --slug <slug> [--app-url <url>]'); process.exit(1); }
  const { scenario } = await import(`./scenarios/${key}.mjs`);
  if (scenario.requiresPrivate && process.env.DEMO_ACCESS_MODE !== 'private') {
    console.error(`Le scénario « ${key} » ne se charge que sur une démo privée (DEMO_ACCESS_MODE=private).`);
    process.exit(1);
  }
  const { tenantId, sql } = buildSeedSql(scenario, { slug, appUrl: (arg('app-url') ?? '').replace(/\/$/, '') });
  console.error(`tenant ${tenantId}`);
  process.stdout.write(sql);
}
