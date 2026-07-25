-- 031_storefront_ready.sql
-- Flag multi-tenant per nascondere l'accesso alla boutique online finché
-- non è pronta. Default true per non rompere i tenant già live.
alter table tenants
  add column if not exists storefront_ready boolean not null default true;

comment on column tenants.storefront_ready is
  'Se false, il link "Voir nos produits" sulla /card viene sostituito da un messaggio "boutique bientôt disponible".';
