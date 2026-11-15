-- 185: growth prospecting tables (run after the 185 fixture and the migration twice).
set role service_role;
insert into public.growth_prospects (id, name, city, country, segment, status, fit_score, priority, entry_kind, entry_verified, dossier, evaluation, first_seen, last_seen)
values ('mama-koko--bologna', 'Mama Koko', 'Bologna', 'IT', 'boutique-alimentare-africana', 'pronta', 80, 'A', 'visit', true, '{}'::jsonb, '{}'::jsonb, '2026-11-14', '2026-11-14');

do $$ begin
  if (select sales_stage from public.growth_prospects where id = 'mama-koko--bologna') <> 'da_contattare' then raise exception 'default stage'; end if;
  -- A suppression needs a reason.
  begin
    update public.growth_prospects set do_not_contact = true where id = 'mama-koko--bologna';
    raise exception 'do_not_contact without reason accepted';
  exception when check_violation then null; end;
  update public.growth_prospects set do_not_contact = true, do_not_contact_reason = 'Pas intéressé' where id = 'mama-koko--bologna';
  -- A status the import never stores.
  begin
    insert into public.growth_prospects (id, name, city, country, segment, status, fit_score, entry_kind, entry_verified, dossier, evaluation, first_seen, last_seen)
    values ('x--y', 'X', 'Y', 'IT', 's', 'respinta', 0, 'none', false, '{}', '{}', '2026-11-14', '2026-11-14');
    raise exception 'rejected dossier stored';
  exception when check_violation then null; end;
  -- A refusal needs a reason; contacts are append-only.
  begin
    insert into public.growth_prospect_touches (prospect_id, channel, outcome) values ('mama-koko--bologna', 'visita', 'rifiuto');
    raise exception 'refusal without reason accepted';
  exception when check_violation then null; end;
  insert into public.growth_prospect_touches (prospect_id, channel, outcome, message_text) values ('mama-koko--bologna', 'whatsapp', 'contattato', 'Bonjour');
  begin
    update public.growth_prospect_touches set note = 'x';
    raise exception 'touch updated';
  exception when others then if sqlerrm not in ('growth_touch_append_only', 'permission denied for table growth_prospect_touches') then raise; end if; end;
  begin
    delete from public.growth_prospect_touches;
    raise exception 'touch deleted';
  exception when others then if sqlerrm not in ('growth_touch_append_only', 'permission denied for table growth_prospect_touches') then raise; end if; end;
  -- Suppression keys are strong identity keys only.
  insert into public.growth_suppressions (identity_key, prospect_id, reason) values ('tel:3331112223', 'mama-koko--bologna', 'Refus');
  begin
    insert into public.growth_suppressions (identity_key, reason) values ('name:mamakoko@bologna', 'Refus');
    raise exception 'weak key suppressed';
  exception when check_violation then null; end;
end $$;
reset role;

-- The owner trigger also blocks changes made outside the service role grants.
do $$ begin
  begin
    delete from public.growth_prospect_touches;
    raise exception 'owner deleted a touch';
  exception when others then if sqlerrm <> 'growth_touch_append_only' then raise; end if; end;
end $$;

set role anon;
do $$ begin
  begin perform 1 from public.growth_prospects; raise exception 'anon read growth_prospects';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
do $$ begin
  begin perform 1 from public.growth_suppressions; raise exception 'authenticated read growth_suppressions';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
