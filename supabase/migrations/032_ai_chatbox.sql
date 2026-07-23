-- 032_ai_chatbox.sql
-- Chatbox IA pubblica — scope: catalogo/disponibilità/info negozio, MAI dati etichetta

alter table public.tenants
  add column if not exists ai_chatbox_enabled boolean not null default false;

comment on column public.tenants.ai_chatbox_enabled is
  'Attiva il widget chatbox pubblico sullo storefront per questo tenant.';

alter table public.tenants
  add column if not exists chatbox_extra_context text;

comment on column public.tenants.chatbox_extra_context is
  'Testo libero curato manualmente dall''admin (orari, zone di consegna, politiche
  di reso, ecc.) iniettato nel system prompt del chatbox. Mai generato o modificato
  dall''IA — solo scritto/editato a mano in admin.';

-- Non abilitare automaticamente nessun tenant qui: l'attivazione è una scelta
-- esplicita da fare via UPDATE manuale o da admin UI dopo il deploy.
