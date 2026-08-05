-- ─── MIGRATION 048: TENANT ANDROID APP (TWA / Digital Asset Links) ───────────
-- Aggiunge package name e fingerprint di firma Android al tenant, per servire
-- /.well-known/assetlinks.json dinamicamente (verifica dominio Play Store TWA).

alter table tenants
  add column if not exists android_package_name text,
  add column if not exists android_sha256_fingerprint text;

comment on column tenants.android_package_name is
  'Package name Android della TWA pubblicata su Play Store per questo tenant '
  '(es. "com.lepefy.chloefood.twa"). NULL finché il tenant non ha un app Android.';
comment on column tenants.android_sha256_fingerprint is
  'Fingerprint SHA256 della chiave di firma upload/signing usata per generare '
  'la TWA, formato "AA:BB:CC:..." con i due punti come da Google. Necessario '
  'per la verifica Digital Asset Links su /.well-known/assetlinks.json.';

-- Nessun GRANT aggiuntivo necessario: grant select on public.tenants to anon
-- (026_ai_descriptions.sql) è a livello di tabella, copre già queste colonne.
