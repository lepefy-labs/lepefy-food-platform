-- 186 — Application installable (PWA) : compteurs agrégés.
--
-- Mesure si l'invitation « Installer l'application » (page /app, liens des
-- e-mails commande) fonctionne : visites de la page par source, installations,
-- ouvertures depuis l'icône. Compteurs AGRÉGÉS (jour × événement × source),
-- aucune donnée personnelle, aucun identifiant de visiteur, pas de cookie.
-- Service role en lecture seule ; écrit uniquement par record_storefront_app_event.
--
-- Additive et rejouable. Le code est fail-open : migration absente = aucun
-- compteur, la page /app et les e-mails fonctionnent comme avant.
--
-- Rollback :
--   drop function if exists public.record_storefront_app_event(uuid, text, text);
--   drop table if exists public.storefront_app_counts;

begin;

create table if not exists public.storefront_app_counts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day       date not null,
  event     text not null check (event in (
    'install_page_view',   -- page /app affichée
    'install_prompt',      -- bouton « Installer » natif touché (Android/Chrome)
    'install_accepted',    -- invite native acceptée
    'app_installed',       -- événement navigateur appinstalled
    'standalone_launch'    -- boutique ouverte depuis l'icône (une fois par session)
  )),
  source    text not null check (source in ('email_confirmed', 'email_completed', 'banner', 'direct')),
  hits      integer not null default 0 check (hits >= 0),
  primary key (tenant_id, day, event, source)
);

comment on table public.storefront_app_counts is
  'Application installable (186) : compteurs agrégés par jour Europe/Paris, événement et source. Aucune donnée personnelle.';

alter table public.storefront_app_counts enable row level security;
alter table public.storefront_app_counts force row level security;
revoke all on public.storefront_app_counts from public, anon, authenticated, service_role;
grant select on public.storefront_app_counts to service_role;

-- +1 sur le compteur du jour. Événement ou source inconnus = false, jamais d'erreur.
create or replace function public.record_storefront_app_event(p_tenant_id uuid, p_event text, p_source text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null
     or p_event not in ('install_page_view', 'install_prompt', 'install_accepted', 'app_installed', 'standalone_launch')
     or p_source not in ('email_confirmed', 'email_completed', 'banner', 'direct') then
    return false;
  end if;
  insert into public.storefront_app_counts (tenant_id, day, event, source, hits)
  values (p_tenant_id, (now() at time zone 'Europe/Paris')::date, p_event, p_source, 1)
  on conflict (tenant_id, day, event, source) do update set hits = storefront_app_counts.hits + 1;
  return true;
end $$;

revoke all on function public.record_storefront_app_event(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_storefront_app_event(uuid, text, text) to service_role;

commit;
