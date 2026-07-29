/**
 * scripts/backfill-admin-users.mjs
 * Lepefy Food — Backfill `admin_users` depuis la whitelist plate ADMIN_EMAILS
 * Usa fetch nativo per Supabase REST API — nessuna dipendenza da ws/Realtime
 *
 * Per ogni email in ADMIN_EMAILS, cerca l'utente corrispondente in auth.users
 * (deve già esistere: gli admin attuali si autenticano già via Supabase Auth,
 * requireAdmin.ts chiama supabase.auth.getUser()). Ogni email trovata viene
 * inserita in admin_users come platform_owner — preserva il comportamento
 * attuale di ADMIN_EMAILS (accesso globale a tutti i tenant). Le email non
 * trovate in auth.users sono loggate, non inserite: richiedono che quella
 * persona abbia fatto login almeno una volta prima del backfill.
 *
 * Riassegnare un admin a tenant_admin (es. Dalice → ChloeFood) è un passo
 * manuale successivo, via SQL Editor — non automatizzabile da questo script.
 */

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAILS  = process.env.ADMIN_EMAILS ?? '';
const DRY_RUN       = process.env.DRY_RUN === 'true';

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

async function sbPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase POST ${path}: ${res.status} ${await res.text()}`);
}

// auth.users n'est pas exposé via PostgREST — passe par l'endpoint Admin Auth.
async function listAuthUsers() {
  const users = [];
  let page = 1;
  const perPage = 200;

  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!res.ok) throw new Error(`Auth admin GET users: ${res.status} ${await res.text()}`);
    const json = await res.json();
    const batch = json.users ?? [];
    users.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }

  return users;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Lepefy Food — Backfill admin_users (ADMIN_EMAILS) ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Dry run : ${DRY_RUN}`);
  console.log('');

  const emails = ADMIN_EMAILS
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  console.log(`📧 Email totali in ADMIN_EMAILS : ${emails.length}`);
  if (emails.length === 0) {
    console.log('✅ Rien à faire.');
    return;
  }

  const authUsers = await listAuthUsers();
  const authByEmail = new Map(
    authUsers
      .filter((u) => u.email)
      .map((u) => [u.email.toLowerCase(), u]),
  );

  // Filtro in JS dopo fetch — mai query PostgREST su colonne che potrebbero
  // non esistere ancora (SKIP_EXISTING pattern come da convenzione progetto).
  const existingAdmins = await sbGet('admin_users?select=email');
  const existingEmails = new Set(existingAdmins.map((a) => a.email.toLowerCase()));

  const found = [];
  const notFound = [];
  const alreadyMigrated = [];

  for (const email of emails) {
    if (existingEmails.has(email)) {
      alreadyMigrated.push(email);
      continue;
    }
    const user = authByEmail.get(email);
    if (user) {
      found.push(user);
    } else {
      notFound.push(email);
    }
  }

  console.log(`📧 Email trovate in auth.users     : ${found.length}`);
  console.log(`📧 Email già presenti in admin_users : ${alreadyMigrated.length}`);
  console.log(`📧 Email NON trovate in auth.users  : ${notFound.length}`);
  console.log('');

  let inserted = 0;
  for (const user of found) {
    console.log(`→ ${user.email} (${user.id}) — platform_owner`);
    if (!DRY_RUN) {
      await sbPost('admin_users', {
        id: user.id,
        email: user.email,
        role: 'platform_owner',
        tenant_id: null,
        active: true,
      });
    }
    inserted += 1;
  }

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log(`✅ Inserite     : ${inserted}${DRY_RUN ? ' (dry run — nessuna scrittura)' : ''}`);
  console.log(`⏭️  Già presenti : ${alreadyMigrated.length}`);
  if (notFound.length > 0) {
    console.log(`❌ Da gestire manualmente (nessun login mai effettuato) :`);
    for (const email of notFound) console.log(`   - ${email}`);
  }
}

main().catch((err) => {
  console.error('\n💥 Errore fatale:', err.message);
  process.exit(1);
});
