/**
 * scripts/demo/seed-demo.mjs — seed et remise à zéro de la Demo Experience
 * (docs/DEMO_EXPERIENCE.md §6). Lancé par les workflows demo-seed / demo-reset.
 *
 *   node scripts/demo/seed-demo.mjs --scenario traiteur-africain [--reset] [--dry-run] [--force]
 *
 * Env obligatoires :
 *   DEMO_SUPABASE_URL, DEMO_SUPABASE_SERVICE_ROLE_KEY — base Supabase de la démo (jamais la production)
 *   DEMO_SUPABASE_PROJECT_REF — identifiant du projet démo : l'URL doit le contenir, sinon refus
 *   DEMO_TENANT_SLUG — slug du tenant de démo (ex. lepefy-demo)
 * Env facultatives :
 *   DEMO_APP_URL — URL du déploiement de démo (liens, invalidation du cache)
 *   DEMO_INTERNAL_TOKEN — jeton de POST /api/internal/demo/revalidate
 *   DEMO_PRESENTER_EMAILS — admins Lepefy qui présentent (tenant_admin du tenant de démo)
 *   DEMO_ACCESS_MODE — 'private' requis pour un scénario privé (nom d'un prospect)
 *   DEMO_REQUESTED_BY — nom affiché dans l'historique des remises à zéro
 */
import { createRestStore } from './lib/restStore.mjs';
import { runReset, runSeed } from './lib/seedRunner.mjs';

const SCENARIOS = {
  'traiteur-africain': () => import('./scenarios/traiteur-africain.mjs'),
  'tata-pao': () => import('./scenarios/tata-pao.mjs'),
};

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

/** La base visée est-elle bien le projet de la démo ? (protection contre la production) */
export function assertDemoProject(url, projectRef) {
  if (!projectRef || !/^[a-z0-9]{10,40}$/.test(projectRef)) throw new Error('DEMO_SUPABASE_PROJECT_REF manquant ou invalide.');
  let host;
  try { host = new URL(url).hostname; } catch { throw new Error('DEMO_SUPABASE_URL invalide.'); }
  if (host.split('.')[0] !== projectRef) throw new Error(`DEMO_SUPABASE_URL (${host}) ne correspond pas au projet démo ${projectRef} : refusé.`);
}

async function main() {
  const scenarioKey = arg('scenario');
  const load = typeof scenarioKey === 'string' ? SCENARIOS[scenarioKey] : null;
  if (!load) throw new Error(`Scénario inconnu. Disponibles : ${Object.keys(SCENARIOS).join(', ')}`);
  const { scenario } = await load();

  const url = process.env.DEMO_SUPABASE_URL;
  const serviceKey = process.env.DEMO_SUPABASE_SERVICE_ROLE_KEY;
  const slug = process.env.DEMO_TENANT_SLUG;
  if (!url || !serviceKey || !slug) throw new Error('DEMO_SUPABASE_URL, DEMO_SUPABASE_SERVICE_ROLE_KEY et DEMO_TENANT_SLUG sont obligatoires.');
  assertDemoProject(url, process.env.DEMO_SUPABASE_PROJECT_REF);
  if (!/^[a-z][a-z0-9-]{2,40}$/.test(slug)) throw new Error('DEMO_TENANT_SLUG invalide.');
  if (scenario.requiresPrivate && process.env.DEMO_ACCESS_MODE !== 'private') {
    throw new Error(`Le scénario « ${scenario.key} » porte le nom d'un prospect : il ne se charge que sur une démo privée (DEMO_ACCESS_MODE=private).`);
  }

  const dryRun = arg('dry-run') === true;
  const reset = arg('reset') === true;
  const appUrl = (process.env.DEMO_APP_URL ?? '').replace(/\/$/, '');
  const options = {
    slug, appUrl, anchor: new Date(), log: console.log, force: arg('force') === true,
    requestedBy: process.env.DEMO_REQUESTED_BY || 'GitHub Actions',
    presenters: (process.env.DEMO_PRESENTER_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean),
  };
  const store = createRestStore({ url, serviceKey, dryRun });

  console.log(`🌱 Démo « ${slug} » — scénario ${scenario.key} v${scenario.version} — ${reset ? 'remise à zéro' : 'seed'}${dryRun ? ' (dry-run)' : ''}`);
  const result = reset ? await runReset(store, scenario, options) : await runSeed(store, scenario, options);
  console.log(`   tenant : ${result.tenantId}${result.archivedTenantId ? ` (ancien archivé : ${result.archivedTenantId})` : ''}`);

  if (!dryRun && appUrl && process.env.DEMO_INTERNAL_TOKEN) {
    const response = await fetch(`${appUrl}/api/internal/demo/revalidate`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.DEMO_INTERNAL_TOKEN}` } }).catch(() => null);
    console.log(`   cache du déploiement : ${response?.ok ? 'invalidé' : 'non invalidé (expire seul en une heure au plus)'}`);
  }
  console.log(dryRun ? '✅ Dry-run terminé (aucune écriture).' : '✅ Terminé.');
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('seed-demo.mjs')) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    // Présentation en cours : la remise à zéro nocturne s'abstient, ce n'est pas une erreur.
    if (message.includes('demo_presentation_active')) {
      console.log('⏸ Présentation en cours : remise à zéro reportée.');
      return;
    }
    console.error('❌', message);
    process.exit(1);
  });
}
