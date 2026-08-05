-- ─── MIGRATION 049: TENANT ANDROID APP — PUBLIC RELEASE FLAG ────────────────
-- tenants.android_package_name e tenants.android_sha256_fingerprint esistono
-- già (048_tenant_android_app.sql, integrazione TWA / Digital Asset Links).
-- Questa migration aggiunge solo il campo mancante: un flag esplicito che
-- distingue "l'app esiste su Play Store" (package_name valorizzato) da
-- "l'app è pubblicamente installabile" (closed testing concluso).
--
-- Durante il closed testing (gate 12 tester/14gg), la scheda pubblica
-- play.google.com/store/apps/details?id=... non è raggiungibile dal pubblico
-- generico — solo chi usa il link di opt-in tester può installare. Se /go
-- reindirizzasse lì chiunque scansioni il QR "QR Shop" oggi, la maggior parte
-- dei clienti vedrebbe una pagina "non disponibile". Il redirect
-- (src/app/go/route.ts) controlla quindi android_public oltre a
-- android_package_name, non in sua vece.

alter table tenants add column if not exists android_public boolean not null default false;

comment on column tenants.android_public is
  'true solo quando l''app Android è uscita dal closed testing ed è pubblicamente '
  'installabile da Play Store. Finché è false (default), /go reindirizza sempre allo shop '
  'anche se android_package_name è già valorizzato (evita di mandare i clienti a una scheda '
  'Play Store non ancora accessibile durante il testing). Flip manuale via SQL il giorno '
  'del lancio pubblico.';

-- Nessun GRANT aggiuntivo necessario: grant select on public.tenants to anon
-- (026_ai_descriptions.sql) è a livello di tabella, copre già questa colonna —
-- stesso ragionamento già verificato per android_package_name /
-- android_sha256_fingerprint in 048_tenant_android_app.sql.
