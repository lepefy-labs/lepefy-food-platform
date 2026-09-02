-- Platform-only prospecting. Additive, no tenant backfill or tenant-table changes.
begin;
create table public.platform_prospects (
  id uuid primary key default gen_random_uuid(),
  business_name text not null check (length(business_name) between 1 and 300),
  legal_name text, siren text check (siren is null or siren ~ '^[0-9]{9}$'),
  siret text unique check (siret is null or siret ~ '^[0-9]{14}$'),
  naf_ape_code text, business_category text, country text not null default 'FR',
  region text, department text, city text, postal_code text, address text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  website_url text, domain text, identity_key text,
  phone text, public_email text, instagram_url text, facebook_url text, tiktok_url text, whatsapp_url text,
  discovery_source text not null, source_external_id text,
  discovered_at timestamptz not null default now(), last_enriched_at timestamptz,
  website_checked_at timestamptz, osm_checked_at timestamptz,
  crawl_status text not null default 'pending' check (crawl_status in ('pending','running','completed','partial','blocked','failed')),
  crawl_http_status integer, crawl_error text,
  has_website boolean, has_ecommerce boolean, has_online_ordering boolean, has_whatsapp_ordering boolean,
  has_delivery boolean, has_events boolean, has_catering boolean, has_loyalty boolean,
  has_instagram boolean, has_facebook boolean, has_tiktok boolean, has_multiple_locations boolean,
  website_title text, website_description text, technologies jsonb not null default '[]',
  evidence jsonb not null default '[]', osm_metadata jsonb not null default '{}',
  fit_score integer not null default 0 check (fit_score between 0 and 100),
  qualification_level text not null default 'low' check (qualification_level in ('low','medium','high','priority')),
  detected_problems jsonb not null default '[]', recommended_modules jsonb not null default '[]',
  qualification_reason text, score_breakdown jsonb not null default '[]',
  status text not null default 'discovered' check (status in ('discovered','enriched','qualified','contacted','replied','demo','pilot','won','lost','ignored')),
  last_contact_at timestamptz, next_action_at timestamptz, notes text, lost_reason text,
  do_not_contact boolean not null default false, suppression_reason text, suppressed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index platform_prospects_score_idx on public.platform_prospects(fit_score desc, id);
create index platform_prospects_status_idx on public.platform_prospects(status, qualification_level);
create index platform_prospects_location_idx on public.platform_prospects(country, region, department);
create index platform_prospects_domain_idx on public.platform_prospects(domain);
create index platform_prospects_identity_idx on public.platform_prospects(identity_key);
create index platform_prospects_outbound_idx on public.platform_prospects(fit_score desc)
  where do_not_contact = false and status in ('discovered','enriched','qualified');
create table public.platform_prospect_runs (
  id uuid primary key default gen_random_uuid(), signature text not null,
  kind text not null check (kind in ('discovery','enrichment')),
  status text not null default 'pending' check (status in ('pending','running','completed','partial','blocked','failed')),
  config jsonb not null default '{}', cursor jsonb not null default '{}',
  processed integer not null default 0, inserted integer not null default 0, duplicates integer not null default 0,
  succeeded integer not null default 0, blocked integer not null default 0, failed integer not null default 0,
  error text, next_attempt_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index platform_prospect_runs_active_idx on public.platform_prospect_runs(signature)
  where status in ('pending','running','blocked');
create index platform_prospect_runs_recent_idx on public.platform_prospect_runs(created_at desc);
create table public.platform_prospect_cache (
  key text primary key, payload jsonb not null, expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
-- One durable gate serves cross-instance pipeline leases and external-source cooldowns.
create table public.platform_prospect_gates (
  key text primary key, token uuid not null, available_at timestamptz not null
);
create function public.claim_platform_prospect_gate(p_key text, p_token uuid, p_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_seconds < 1 or p_seconds > 86400 then raise exception 'invalid_gate_duration'; end if;
  insert into public.platform_prospect_gates(key, token, available_at)
    values (p_key, p_token, now() + make_interval(secs => p_seconds))
    on conflict (key) do update set token = excluded.token, available_at = excluded.available_at
      where platform_prospect_gates.available_at <= now();
  return found;
end;
$$;
create function public.release_platform_prospect_gate(p_key text, p_token uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.platform_prospect_gates where key = p_key and token = p_token;
$$;
create function public.touch_platform_prospect() returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  if TG_TABLE_NAME = 'platform_prospects' then
    if new.do_not_contact and (TG_OP = 'INSERT' or not old.do_not_contact) then new.suppressed_at = now(); end if;
    if not new.do_not_contact then new.suppressed_at = null; end if;
  end if;
  return new;
end;
$$;
create trigger platform_prospect_updated before insert or update on public.platform_prospects
  for each row execute function public.touch_platform_prospect();
create trigger platform_prospect_run_updated before update on public.platform_prospect_runs
  for each row execute function public.touch_platform_prospect();
do $$
declare t text;
begin
  foreach t in array array['platform_prospects','platform_prospect_runs','platform_prospect_cache','platform_prospect_gates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end;
$$;
revoke all on function public.claim_platform_prospect_gate(text,uuid,integer) from public, anon, authenticated;
revoke all on function public.release_platform_prospect_gate(text,uuid) from public, anon, authenticated;
revoke all on function public.touch_platform_prospect() from public, anon, authenticated;
grant execute on function public.claim_platform_prospect_gate(text,uuid,integer) to service_role;
grant execute on function public.release_platform_prospect_gate(text,uuid) to service_role;
comment on table public.platform_prospects is 'Public business prospects, never tenants. Suppressed records excluded from outbound selection.';
comment on table public.platform_prospect_cache is 'Minimized provider results only; never full website HTML or personal directors.';
commit;
