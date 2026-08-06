/**
 * scripts/backfill-phone-e164.mjs
 * Lepefy Food — Backfill numeri di telefono clienti in formato E.164
 * Usa fetch nativo per Supabase REST API — nessuna dipendenza da ws/Realtime
 *
 * Per ogni customer con phone IS NOT NULL, verifica se è già un E.164 valido
 * (skip, non riscritto). In caso contrario tenta parsePhoneNumberFromString
 * usando il country del tenant proprietario (join customers.tenant_id →
 * tenants.country) come defaultCountry, e se il risultato è valido aggiorna
 * il record con la forma canonica .number. I numeri impossibili da parsare
 * restano invariati e finiscono nel report "falliti" — da rivedere a mano,
 * mai toccati da questo script.
 */

import { parsePhoneNumberFromString } from 'libphonenumber-js';

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Par sécurité (écriture sur des données de contact clients), DRY_RUN est
// actif par défaut : il faut positionner explicitement DRY_RUN=false pour
// écrire — inverse de la convention de backfill-admin-users.mjs, volontaire
// ici vu l'impact d'une écriture erronée sur des numéros déjà en base.
const DRY_RUN = process.env.DRY_RUN !== 'false';

const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  .filter((k) => !process.env[k]);
if (missing.length) {
  console.error('❌ Env vars mancanti:', missing.join(', '));
  process.exit(1);
}

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

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${path}: ${res.status} ${await res.text()}`);
}

function isE164(phone) {
  if (!phone.startsWith('+')) return false;
  const parsed = parsePhoneNumberFromString(phone);
  return Boolean(parsed && parsed.isValid() && parsed.number === phone);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Lepefy Food — Backfill phone → E.164            ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Dry run : ${DRY_RUN}`);
  console.log('');

  const tenants = await sbGet('tenants?select=id,country');
  const tenantCountryById = new Map(tenants.map((t) => [t.id, t.country]));

  const customers = await sbGet('customers?select=id,tenant_id,phone&phone=not.is.null');

  console.log(`📋 Righe totali con phone non nullo : ${customers.length}`);
  console.log('');

  let alreadyValid = 0;
  let converted = 0;
  const failed = [];

  for (const customer of customers) {
    const rawPhone = (customer.phone ?? '').trim();
    if (!rawPhone) continue;

    if (isE164(rawPhone)) {
      alreadyValid += 1;
      continue;
    }

    const tenantCountry = tenantCountryById.get(customer.tenant_id);
    const parsed = tenantCountry ? parsePhoneNumberFromString(rawPhone, tenantCountry) : null;

    if (!parsed || !parsed.isValid()) {
      failed.push({ id: customer.id, tenant_id: customer.tenant_id, phone: rawPhone });
      continue;
    }

    console.log(`→ customer ${customer.id} : "${rawPhone}" → "${parsed.number}" (tenant country: ${tenantCountry})`);
    if (!DRY_RUN) {
      await sbPatch(`customers?id=eq.${customer.id}`, { phone: parsed.number });
    }
    converted += 1;
  }

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log(`✅ Convertiti        : ${converted}${DRY_RUN ? ' (dry run — nessuna scrittura)' : ''}`);
  console.log(`⏭️  Già validi E.164  : ${alreadyValid}`);
  console.log(`❌ Falliti (a mano)  : ${failed.length}`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`   - customer ${f.id} (tenant ${f.tenant_id}) : "${f.phone}"`);
  }
}

main().catch((err) => {
  console.error('\n💥 Errore fatale:', err.message);
  process.exit(1);
});
