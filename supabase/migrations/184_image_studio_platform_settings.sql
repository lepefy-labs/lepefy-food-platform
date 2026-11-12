-- 184 — Studio images : réglages par tenant depuis la console plateforme
-- (docs/IMAGE_STUDIO.md §9).
--
-- `studio_tenant_settings` (183) est en lecture seule pour le service role :
-- la console « Studio images » du platform owner écrit les quotas par cette
-- RPC unique (bornes contrôlées en SQL, une ligne par tenant). Additive et
-- rieseguibile ; rollback en fin de fichier.

begin;

create or replace function public.studio_set_tenant_settings(
  p_tenant_id uuid, p_monthly_revisions integer, p_monthly_budget_usd numeric, p_draft_retention_days integer
)
returns table (out_monthly_revisions integer, out_monthly_budget_usd numeric, out_draft_retention_days integer)
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.tenants where id = p_tenant_id;
  if not found then raise exception 'tenant_not_found'; end if;
  if p_monthly_revisions is null or p_monthly_revisions not between 0 and 5000
     or p_monthly_budget_usd is null or p_monthly_budget_usd < 0 or p_monthly_budget_usd > 10000
     or p_draft_retention_days is null or p_draft_retention_days not between 7 and 365 then
    raise exception 'studio_invalid_request';
  end if;
  insert into public.studio_tenant_settings (tenant_id, monthly_revisions, monthly_budget_usd, draft_retention_days, updated_at)
  values (p_tenant_id, p_monthly_revisions, round(p_monthly_budget_usd, 2), p_draft_retention_days, now())
  on conflict (tenant_id) do update set
    monthly_revisions = excluded.monthly_revisions,
    monthly_budget_usd = excluded.monthly_budget_usd,
    draft_retention_days = excluded.draft_retention_days,
    updated_at = now();
  return query
    select s.monthly_revisions, s.monthly_budget_usd, s.draft_retention_days
    from public.studio_tenant_settings s where s.tenant_id = p_tenant_id;
end;
$$;

revoke all on function public.studio_set_tenant_settings(uuid, integer, numeric, integer) from public, anon, authenticated;
grant execute on function public.studio_set_tenant_settings(uuid, integer, numeric, integer) to service_role;

insert into public.audit_event_types (key, module, category, default_severity, retention_class) values
  ('studio.settings.updated', 'studio', 'activity', 'notice', 'business')
on conflict (key) do nothing;

commit;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- drop function if exists public.studio_set_tenant_settings(uuid, integer, numeric, integer);
-- -- audit_event_types studio.settings.updated reste (référencé par audit_events, append-only).
