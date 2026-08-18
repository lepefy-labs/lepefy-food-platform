-- ─── MIGRATION 066: SCOPING PER MODULO — tenant_payment_methods ─────────────
-- Fase B dell'HUB pagamenti: permette di limitare un metodo di pagamento a
-- un sottoinsieme di moduli (shop/card/event/rental) invece di mostrarlo
-- sempre ovunque. Default = tutti e 4 i moduli, per preservare esattamente
-- il comportamento attuale sulle righe esistenti — zero rottura, Dalice
-- decide da /admin/parametres/paiements quando vorrà restringere qualcosa.

alter table public.tenant_payment_methods
  add column if not exists enabled_modules text[] not null default array['shop','card','event','rental'];

alter table public.tenant_payment_methods
  add constraint tenant_payment_methods_enabled_modules_check
  check (enabled_modules <@ array['shop','card','event','rental']::text[] and array_length(enabled_modules, 1) > 0);

comment on column public.tenant_payment_methods.enabled_modules is
  'Moduli in cui questo metodo di pagamento è proposto al cliente — '
  'sottoinsieme di {shop,card,event,rental}. Default: tutti e 4 (comportamento '
  'storico prima di questa migration). Letto da ogni pagina che consuma '
  'getTenantPaymentMethods per filtrare i metodi da mostrare in quel modulo.';
