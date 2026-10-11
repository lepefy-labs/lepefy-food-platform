/**
 * Rapport du format de vente d'un tenant — LECTURE SEULE, aucune écriture.
 *
 *   pnpm catalog:selling-format:report [--tenant <slug>]
 *
 * Pour chaque produit actif : la phrase que voit le client aujourd'hui
 * (lib/storefrontCopy/sellingFormat.ts) et la source utilisée
 * (structuré 154 / quantité nette lisible / aucune). Sert à savoir quels
 * produits compléter dans l'éditeur (« Format de vente »). Fonctionne avant
 * et après la migration 154 (colonnes structurées lues si elles existent).
 * Env : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_TENANT_SLUG.
 */
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { describePrice, resolveSellingFormat, type SellingFormatSource } from '../src/lib/storefrontCopy/sellingFormat';

const { values } = parseArgs({ options: { tenant: { type: 'string' } } });
const slug = values.tenant ?? process.env.NEXT_PUBLIC_TENANT_SLUG;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!slug || !url || !key) {
  console.error('Missing --tenant / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const { data: tenant, error: tenantError } = await db.from('tenants').select('id, name, currency').eq('slug', slug).single();
if (tenantError || !tenant) {
  console.error(`Tenant "${slug}" not found.`);
  process.exit(1);
}

type Row = SellingFormatSource & { name: string; price: number };
const base = 'name, price, net_quantity_display';
let structured = true;
let rows: Row[] | null = null;
{
  const res = await db.from('products').select(`${base}, sale_unit, net_content_value, net_content_unit, pack_count`)
    .eq('tenant_id', tenant.id).eq('active', true).order('name');
  if (res.error) {
    structured = false;
    const fallback = await db.from('products').select(base).eq('tenant_id', tenant.id).eq('active', true).order('name');
    if (fallback.error) { console.error(fallback.error.message); process.exit(1); }
    rows = fallback.data as Row[];
  } else {
    rows = res.data as Row[];
  }
}

const counts = { structured: 0, net_quantity: 0, none: 0 };
const toComplete: string[] = [];
for (const row of rows ?? []) {
  const format = resolveSellingFormat(row);
  counts[format.source] += 1;
  const shown = describePrice(Number(row.price), format, tenant.currency ?? 'EUR').sentence.replace(/[  ]/g, ' ');
  if (format.source !== 'structured') {
    toComplete.push(`${format.source === 'none' ? '·' : '~'} ${row.name} → « ${shown} »${row.net_quantity_display && format.source === 'none' ? `  (quantité nette illisible : "${row.net_quantity_display}")` : ''}`);
  }
}

console.log(`${tenant.name} — ${rows?.length ?? 0} produits actifs${structured ? '' : ' (migration 154 absente : colonnes structurées ignorées)'}`);
console.log(`  format structuré         : ${counts.structured}`);
console.log(`  quantité nette lisible   : ${counts.net_quantity}  (« les 500 g »)`);
console.log(`  sans format (l'article)  : ${counts.none}`);
if (toComplete.length) {
  console.log('\nÀ compléter dans « Format de vente » (~ quantité nette seule, · aucun format) :');
  for (const line of toComplete) console.log(`  ${line}`);
}
