-- 174: Help Center — editorial workflow, immutable revisions, tenant projections
-- (published only, tenant isolation, level), minimised metrics, privileges, no commercial side effect.
do $$
declare
  v_a uuid := '10000000-0000-4000-8000-000000000001';
  v_b uuid := '10000000-0000-4000-8000-000000000002';
  v_actor uuid := '90000000-0000-4000-8000-000000000001';
  v_shared uuid;
  v_adv uuid;
  v_only_b uuid;
  v_n integer;
  v_status text;
begin
  -- No entitlement is granted by the migration itself.
  if exists (select 1 from public.platform_plan_features where feature_key like 'help_center%') then
    raise exception 'migration granted the entitlement to a plan';
  end if;
  if (select active from public.platform_features where key = 'help_center_advanced') then
    raise exception 'advanced level must be registered inactive';
  end if;
  if (select billable from public.platform_features where key = 'help_center') then
    raise exception 'standard level must be non billable';
  end if;
  if not exists (
    select 1 from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
    where rp.permission_key = 'help.view' and r.code = 'tenant_admin'
  ) or exists (
    select 1 from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
    where rp.permission_key = 'help.view' and r.code = 'tenant_cashier'
  ) then raise exception 'help.view role mapping is wrong'; end if;

  insert into public.help_articles (slug, module, status) values ('preparer-une-commande', 'commandes', 'draft') returning id into v_shared;
  insert into public.help_articles (slug, module, min_level) values ('guide-avance', 'commandes', 'advanced') returning id into v_adv;
  insert into public.help_articles (slug, module, tenant_id) values ('guide-boutique-b', 'commandes', v_b) returning id into v_only_b;
  insert into public.help_article_translations (article_id, locale, title, summary, blocks, search_text) values
    (v_shared, 'fr', 'Préparer une commande', 'Résumé', '[{"type":"steps","items":["Un","Deux"]}]', 'Ouvrez Commandes puis imprimez la liste de préparation'),
    (v_adv, 'fr', 'Guide avancé', '', '[{"type":"paragraph","text":"x"}]', 'avance'),
    (v_only_b, 'fr', 'Guide B', '', '[{"type":"paragraph","text":"b"}]', 'boutique b');
  insert into public.help_article_contexts (article_id, route_pattern, priority) values (v_shared, '/admin/orders', 10);

  -- Drafts are never served.
  if (select count(*) from public.help_tenant_articles(v_a, 'fr', 'advanced')) <> 0 then raise exception 'draft served to a tenant'; end if;
  if (select count(*) from public.help_tenant_search(v_a, 'fr', 'advanced', 'commandes', 10)) <> 0 then raise exception 'draft found by search'; end if;
  if (select count(*) from public.help_tenant_contexts(v_a)) <> 0 then raise exception 'draft context served'; end if;

  -- Workflow: review is mandatory, forbidden jumps are rejected.
  begin
    perform public.help_set_status(v_shared, 'published', 'draft', v_actor, null);
    raise exception 'draft published without review';
  exception when others then if sqlerrm <> 'help_transition_forbidden' then raise; end if;
  end;
  perform public.help_set_status(v_shared, 'review', 'draft', v_actor, null);
  begin
    perform public.help_set_status(v_shared, 'archived', 'draft', v_actor, null);
    raise exception 'stale expected status accepted';
  exception when others then if sqlerrm <> 'help_status_conflict' then raise; end if;
  end;
  perform public.help_set_status(v_shared, 'published', 'review', v_actor, 'première version');
  if (select published_version from public.help_articles where id = v_shared) <> 1 then raise exception 'first publication is not v1'; end if;

  -- Published content is served to every tenant, with the declared locale fallback.
  if (select count(*) from public.help_tenant_articles(v_a, 'fr', 'standard')) <> 1 then raise exception 'published article not served'; end if;
  if (select locale_used from public.help_tenant_articles(v_a, 'it', 'standard') limit 1) <> 'fr' then raise exception 'locale fallback not declared'; end if;
  if (select count(*) from public.help_tenant_articles(v_b, 'fr', 'standard')) <> 1 then raise exception 'shared article not served to tenant B'; end if;
  if (select count(*) from public.help_tenant_search(v_a, 'fr', 'standard', 'liste préparation', 10)) <> 1 then raise exception 'search missed the published article'; end if;
  if (select count(*) from public.help_tenant_contexts(v_a)) <> 1 then raise exception 'published context not served'; end if;

  -- The working copy never leaks: editing after publication keeps serving the revision.
  update public.help_article_translations set title = 'BROUILLON EN COURS' where article_id = v_shared and locale = 'fr';
  if (select title from public.help_tenant_articles(v_a, 'fr', 'standard') limit 1) <> 'Préparer une commande' then
    raise exception 'working copy leaked to tenants';
  end if;

  -- Revisions are immutable.
  begin
    update public.help_article_revisions set title = 'hack' where article_id = v_shared;
    raise exception 'revision updated';
  exception when others then if sqlerrm <> 'help_revision_immutable' then raise; end if;
  end;

  -- Republication creates v2; restoring v1 refills the working copy without publishing.
  perform public.help_set_status(v_shared, 'published', 'published', v_actor, 'v2');
  if (select published_version from public.help_articles where id = v_shared) <> 2 then raise exception 'republication is not v2'; end if;
  if (select title from public.help_tenant_articles(v_a, 'fr', 'standard') limit 1) <> 'BROUILLON EN COURS' then raise exception 'v2 not served'; end if;
  perform public.help_restore_revision(v_shared, 1, v_actor);
  if (select title from public.help_article_translations where article_id = v_shared and locale = 'fr') <> 'Préparer une commande' then raise exception 'restore failed'; end if;
  if (select published_version from public.help_articles where id = v_shared) <> 2 then raise exception 'restore published something'; end if;
  begin
    perform public.help_restore_revision(v_shared, 99, v_actor);
    raise exception 'unknown revision restored';
  exception when others then if sqlerrm <> 'help_revision_not_found' then raise; end if;
  end;

  -- Level: an advanced guide is invisible at standard level.
  perform public.help_set_status(v_adv, 'review', 'draft', v_actor, null);
  perform public.help_set_status(v_adv, 'published', 'review', v_actor, null);
  if exists (select 1 from public.help_tenant_articles(v_a, 'fr', 'standard') where slug = 'guide-avance') then raise exception 'advanced guide served at standard level'; end if;
  if exists (select 1 from public.help_tenant_articles(v_a, 'fr', 'disabled') where slug = 'guide-avance') then raise exception 'advanced guide served when disabled'; end if;
  if not exists (select 1 from public.help_tenant_articles(v_a, 'fr', 'advanced') where slug = 'guide-avance') then raise exception 'advanced guide hidden at advanced level'; end if;

  -- Tenant isolation: a tenant-specific guide only reaches its own tenant.
  perform public.help_set_status(v_only_b, 'review', 'draft', v_actor, null);
  perform public.help_set_status(v_only_b, 'published', 'review', v_actor, null);
  if exists (select 1 from public.help_tenant_articles(v_a, 'fr', 'advanced') where slug = 'guide-boutique-b') then raise exception 'tenant B guide served to tenant A'; end if;
  if exists (select 1 from public.help_tenant_search(v_a, 'fr', 'advanced', 'boutique', 10) where slug = 'guide-boutique-b') then raise exception 'tenant B guide found by tenant A'; end if;
  if not exists (select 1 from public.help_tenant_articles(v_b, 'fr', 'advanced') where slug = 'guide-boutique-b') then raise exception 'tenant B guide missing for B'; end if;
end $$;

do $$
declare
  v_a uuid := '10000000-0000-4000-8000-000000000001';
  v_actor uuid := '90000000-0000-4000-8000-000000000001';
  v_empty uuid;
  v_shared uuid := (select id from public.help_articles where slug = 'preparer-une-commande');
  v_draft uuid;
begin
  insert into public.help_articles (slug, module) values ('sans-contenu', 'general') returning id into v_empty;
  perform public.help_set_status(v_empty, 'review', 'draft', v_actor, null);
  begin
    perform public.help_set_status(v_empty, 'published', 'review', v_actor, null);
    raise exception 'published without french content';
  exception when others then if sqlerrm <> 'help_missing_french_content' then raise; end if;
  end;

  -- Archive stops serving; revisions stay; the version number is never reused.
  perform public.help_set_status(v_shared, 'archived', 'published', v_actor, null);
  if exists (select 1 from public.help_tenant_articles(v_a, 'fr', 'advanced') where slug = 'preparer-une-commande') then raise exception 'archived article served'; end if;
  if (select count(*) from public.help_article_revisions where article_id = v_shared) <> 2 then raise exception 'revisions lost on archive'; end if;
  perform public.help_set_status(v_shared, 'draft', 'archived', v_actor, null);
  perform public.help_set_status(v_shared, 'review', 'draft', v_actor, null);
  perform public.help_set_status(v_shared, 'published', 'review', v_actor, null);
  if (select published_version from public.help_articles where id = v_shared) <> 3 then raise exception 'version number reused after archive'; end if;

  -- Metrics: aggregate counters, only for servable articles, unknown events ignored.
  if not public.help_record_event(v_a, v_shared, 'view') then raise exception 'view not recorded'; end if;
  perform public.help_record_event(v_a, v_shared, 'view');
  perform public.help_record_event(v_a, v_shared, 'not_helpful');
  if public.help_record_event(v_a, v_shared, 'click_everything') then raise exception 'unknown event recorded'; end if;
  if public.help_record_event(v_a, v_empty, 'view') then raise exception 'event recorded for an unpublished article'; end if;
  if (select total from public.help_article_daily where article_id = v_shared and event = 'view') <> 2 then raise exception 'view counter wrong'; end if;
  perform public.help_record_search(v_a, 'imprimer étiquette', true);
  perform public.help_record_search(v_a, 'imprimer étiquette', true);
  perform public.help_record_search(v_a, 'liste préparation', false);
  if (select total from public.help_search_daily where term = 'imprimer étiquette' and empty) <> 2 then raise exception 'empty search counter wrong'; end if;
  if exists (select 1 from public.help_search_daily where not empty and term <> '') then raise exception 'term stored for a successful search'; end if;
  insert into public.help_article_daily (day, tenant_id, article_id, event, total)
    values (current_date - 200, v_a, v_shared, 'view', 5) on conflict do nothing;
  if public.help_purge_metrics() < 1 then raise exception 'retention purge removed nothing'; end if;
end $$;

-- Privileges: nothing for anon or authenticated; the service role cannot rewrite revisions or metrics directly.
set role anon;
do $$ begin
  perform 1 from public.help_articles;
  raise exception 'anon can read articles';
exception when insufficient_privilege then null;
end $$;
reset role;
set role authenticated;
do $$ begin
  perform 1 from public.help_article_revisions;
  raise exception 'authenticated can read revisions';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.help_tenant_articles('10000000-0000-4000-8000-000000000001', 'fr', 'advanced');
  raise exception 'authenticated can run the tenant projection';
exception when insufficient_privilege then null;
end $$;
reset role;
set role service_role;
do $$ begin
  update public.help_article_revisions set title = 'x';
  raise exception 'service_role can update revisions';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.help_article_daily (day, tenant_id, article_id, event, total)
    values (current_date, '10000000-0000-4000-8000-000000000001', (select id from public.help_articles limit 1), 'view', 99);
  raise exception 'service_role can write metrics directly';
exception when insufficient_privilege then null;
end $$;
reset role;
