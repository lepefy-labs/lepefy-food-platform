/**
 * scripts/demo/build-demo-schema.mjs — SQL complet pour créer le schéma d'un
 * projet Supabase NEUF de démonstration (docs/DEMO_EXPERIENCE.md §2).
 *
 *   node scripts/demo/build-demo-schema.mjs > demo-schema.sql
 *   psql "$DEMO_DATABASE_URL" -v ON_ERROR_STOP=1 -f demo-schema.sql
 *
 * Rejoue toutes les migrations dans l'ordre, avec :
 * - un tenant d'amorçage INACTIF (slug chloefood) créé après 001 : des
 *   migrations historiques y attachent des réglages ; il est SUPPRIMÉ à la fin
 *   avec tout ce qui lui a été rattaché. Aucune donnée de production n'est lue ;
 * - deux correctifs de dérive (DRIFT_PATCHES) : la production a reçu ces
 *   changements hors migration ;
 * - la suppression du tenant lepefy-test inséré par la 138 ;
 * - la table demo_schema_migrations, qui garde la liste des fichiers appliqués.
 *
 * Refuse de produire le SQL pour une base qui contiendrait déjà des tenants :
 * le script de provisionnement (workflow demo-provision) vérifie avant.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations');

/** Correctifs de dérive, exécutés juste AVANT le fichier indiqué. */
export const DRIFT_PATCHES = {
  // Le trigger existe déjà (023_label_job_drafts.sql) : la production a appliqué les deux variantes à la main.
  '023_label_print_jobs_drafts_reprint.sql': 'drop trigger if exists label_print_jobs_updated_at on label_print_jobs;',
  // Colonne ajoutée en production hors migration, référencée par la 076.
  '076_tenant_public_column_security.sql': 'alter table public.tenants add column if not exists hero_image_url text;',
};

const BOOTSTRAP = `insert into public.tenants (slug, name, active) values ('chloefood', 'Amorçage du schéma démo (supprimé à la fin)', false);`;

const CLEANUP = `
-- Fin du provisionnement : aucun tenant hérité des migrations ne reste.
delete from public.tenants where slug = 'chloefood' and active = false and name like 'Amorçage du schéma démo%';
delete from public.tenants where slug = 'lepefy-test';
create table if not exists public.demo_schema_migrations (file text primary key, applied_at timestamptz not null default now());
alter table public.demo_schema_migrations enable row level security;
revoke all on table public.demo_schema_migrations from public, anon, authenticated;
`;

export function migrationFiles() {
  return readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort();
}

export function buildDemoSchemaSql() {
  const parts = ['-- Schéma de la démo Lepefy, généré par scripts/demo/build-demo-schema.mjs', ''];
  for (const file of migrationFiles()) {
    if (DRIFT_PATCHES[file]) parts.push(`-- correctif de dérive avant ${file}`, DRIFT_PATCHES[file], '');
    parts.push(`-- ═══ ${file}`, readFileSync(join(MIGRATIONS, file), 'utf8'), '');
    if (file === '001_initial_schema.sql') parts.push('-- tenant d\'amorçage', BOOTSTRAP, '');
  }
  parts.push(CLEANUP);
  parts.push(`insert into public.demo_schema_migrations (file) values ${migrationFiles().map((file) => `('${file}')`).join(', ')} on conflict do nothing;`);
  return parts.join('\n');
}

if (process.argv[1]?.endsWith('build-demo-schema.mjs')) process.stdout.write(buildDemoSchemaSql());
