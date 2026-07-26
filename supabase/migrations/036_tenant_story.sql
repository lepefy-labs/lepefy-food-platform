-- ─── MIGRATION 036: TENANT STORY SECTION ("Notre origine") ──────────────────
-- Campi editoriali per la sezione "Notre origine" della home. Scritti a mano
-- dal tenant/admin (Dalice/Robertin per ChloeFood), mai generati o dedotti.
-- Questa migrazione crea solo le colonne — nessun valore viene popolato qui.

alter table tenants
  add column if not exists story_heading    text,
  add column if not exists story_text       text,
  add column if not exists story_image_url  text,
  add column if not exists countries_served int;

comment on column tenants.story_heading is
  'Titolo sezione "Notre origine" in home. Se NULL, la sezione non viene renderizzata.';
comment on column tenants.story_text is
  'Testo libero sezione "Notre origine". Scritto dal tenant/admin, mai generato o dedotto.';
comment on column tenants.countries_served is
  'Numero paesi effettivamente serviti, da confermare manualmente dal tenant. '
  'Se NULL, la statistica non viene mostrata — mai un valore di default inventato.';
