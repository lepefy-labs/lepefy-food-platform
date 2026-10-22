-- 163: tenant isolation, internal notes never in the tenant projection,
-- idempotency, state machine, attachments, merge, links, privileges.
do $$
declare
  v_a uuid := '10000000-0000-4000-8000-000000000001';
  v_b uuid := '10000000-0000-4000-8000-000000000002';
  v_admin_a uuid := '20000000-0000-4000-8000-000000000001';
  v_admin_a2 uuid := '20000000-0000-4000-8000-000000000002';
  v_admin_b uuid := '20000000-0000-4000-8000-000000000003';
  v_lepefy uuid := '20000000-0000-4000-8000-000000000009';
  v_key uuid := gen_random_uuid();
  v_t1 uuid; v_n1 bigint; v_created boolean;
  v_t2 uuid; v_n2 bigint;
  v_tb uuid; v_nb bigint;
  v_imp uuid;
  v_status text; v_changed boolean; v_reopened boolean;
  v_msg uuid;
  v_att uuid; v_att2 uuid; v_att_b uuid;
  v_thread jsonb;
  v_count integer;
  v_link uuid;
  i integer;
begin
  -- ─── Création (boutique), idempotence ─────────────────────────────────────
  select out_ticket_id, out_number, out_created into v_t1, v_n1, v_created
  from public.support_create_ticket(v_a, 'tenant', v_admin_a, 'Chloé', 'Impression bloquée',
    'Le bouton imprimer ne fait rien depuis ce matin sur la commande', 'problem', true, 'critical',
    '{"page_label":"Commandes","pathname":"/admin/orders"}'::jsonb, null, null, null, 'whatsapp', 'ref', null, 'faux', false, v_key, null);
  if not v_created or v_n1 < 1001 then raise exception 'ticket not created'; end if;
  -- Une urgence déclarée relève à « high », jamais à « critical » ; la boutique ne choisit ni canal ni visibilité.
  perform 1 from public.support_tickets where id = v_t1 and priority = 'high' and source_channel = 'app' and origin = 'tenant_app'
    and visible_to_tenant and requester_admin_id = v_admin_a and external_reference is null;
  if not found then raise exception 'tenant ticket fields not enforced'; end if;

  select out_ticket_id, out_created into v_t2, v_created
  from public.support_create_ticket(v_a, 'tenant', v_admin_a, 'Chloé', 'Impression bloquée', 'Le bouton imprimer ne fait rien', 'problem',
    false, null, '{}'::jsonb, null, null, null, 'app', null, null, null, true, v_key, null);
  if v_created or v_t2 <> v_t1 then raise exception 'retry created a second ticket'; end if;
  if (select count(*) from public.support_messages where ticket_id = v_t1) <> 1 then raise exception 'retry duplicated the message'; end if;

  -- ─── Limite : 10 demandes par heure et par admin ──────────────────────────
  for i in 1..9 loop
    perform public.support_create_ticket(v_a, 'tenant', v_admin_a, 'Chloé', 'Demande ' || i, 'Texte de la demande numéro ' || i);
  end loop;
  begin
    perform public.support_create_ticket(v_a, 'tenant', v_admin_a, 'Chloé', 'Une de trop', 'Encore une demande de plus');
    raise exception 'rate limit not enforced';
  exception when others then
    if sqlerrm <> 'support_rate_limited' then raise; end if;
  end;

  -- Entrées invalides.
  begin
    perform public.support_create_ticket(v_a, 'tenant', v_admin_a2, 'X', 'Titre', '  ');
    raise exception 'empty body accepted';
  exception when others then if sqlerrm <> 'support_invalid_input' then raise; end if;
  end;

  select out_ticket_id, out_number into v_tb, v_nb
  from public.support_create_ticket(v_b, 'tenant', v_admin_b, 'Bob', 'Impression bloquée chez B',
    'Le bouton imprimer ne fait rien pour la commande, impression impossible');

  -- ─── Isolation entre boutiques ────────────────────────────────────────────
  begin
    perform public.support_post_message(v_t1, v_b, 'tenant', v_admin_b, 'Bob', 'message', 'Intrusion');
    raise exception 'cross-tenant message accepted';
  exception when others then if sqlerrm <> 'support_ticket_not_found' then raise; end if;
  end;
  if public.support_tenant_thread(v_b, v_t1, v_admin_b) is not null then raise exception 'cross-tenant thread readable'; end if;
  begin
    perform public.support_mark_read(v_t1, v_b, v_admin_b, 'tenant');
    raise exception 'cross-tenant read state accepted';
  exception when others then if sqlerrm <> 'support_ticket_not_found' then raise; end if;
  end;
  begin
    perform public.support_record_feedback(v_t1, v_b, v_admin_b, true);
    raise exception 'cross-tenant feedback accepted';
  exception when others then if sqlerrm <> 'support_ticket_not_found' then raise; end if;
  end;
  -- La boutique ne peut pas écrire de note interne.
  begin
    perform public.support_post_message(v_t1, v_a, 'tenant', v_admin_a, 'Chloé', 'internal_note', 'Note');
    raise exception 'tenant internal note accepted';
  exception when others then if sqlerrm <> 'support_invalid_input' then raise; end if;
  end;

  -- Demandes similaires : uniquement la même boutique.
  if exists (select 1 from public.support_similar_tickets(v_b, 'Le bouton imprimer ne fait rien sur la commande') where id = v_t1) then
    raise exception 'similar tickets leaked another tenant';
  end if;
  if not exists (select 1 from public.support_similar_tickets(v_a, 'Le bouton imprimer ne fait rien sur la commande') where id = v_t1) then
    raise exception 'similar ticket of the same tenant not found';
  end if;

  -- ─── Pièces jointes ───────────────────────────────────────────────────────
  insert into public.support_attachments (tenant_id, uploaded_by_admin_id, uploader_type, storage_path, mime_type, size_bytes)
  values (v_a, v_admin_a, 'tenant', v_a::text || '/' || gen_random_uuid()::text || '.png', 'image/png', 1000) returning id into v_att;
  insert into public.support_attachments (tenant_id, uploaded_by_admin_id, uploader_type, storage_path, mime_type, size_bytes)
  values (v_a, v_lepefy, 'lepefy', v_a::text || '/' || gen_random_uuid()::text || '.jpg', 'image/jpeg', 1000) returning id into v_att2;
  insert into public.support_attachments (tenant_id, uploaded_by_admin_id, uploader_type, storage_path, mime_type, size_bytes)
  values (v_b, v_admin_b, 'tenant', v_b::text || '/' || gen_random_uuid()::text || '.png', 'image/png', 1000) returning id into v_att_b;
  -- Fichier d'un autre admin ou d'une autre boutique : refusé, rien n'est écrit.
  begin
    perform public.support_post_message(v_t1, v_a, 'tenant', v_admin_a2, 'Collègue', 'message', 'Voici', null, array[v_att]);
    raise exception 'foreign attachment accepted';
  exception when others then if sqlerrm <> 'support_attachment_invalid' then raise; end if;
  end;
  begin
    perform public.support_post_message(v_t1, v_a, 'tenant', v_admin_a, 'Chloé', 'message', 'Voici', null, array[v_att_b]);
    raise exception 'cross-tenant attachment accepted';
  exception when others then if sqlerrm <> 'support_attachment_invalid' then raise; end if;
  end;
  if (select count(*) from public.support_messages where ticket_id = v_t1) <> 1 then raise exception 'rejected message was written'; end if;

  select out_message_id, out_status into v_msg, v_status
  from public.support_post_message(v_t1, v_a, 'tenant', v_admin_a, 'Chloé', 'message', 'Voici la capture', gen_random_uuid(), array[v_att]);
  if v_status <> 'new' then raise exception 'tenant message changed a new ticket'; end if;
  perform 1 from public.support_attachments where id = v_att and message_id = v_msg and not internal;
  if not found then raise exception 'attachment not attached'; end if;

  -- ─── Note interne + capture interne : jamais dans la projection boutique ──
  perform public.support_post_message(v_t1, null, 'lepefy', v_lepefy, 'Équipe', 'internal_note', 'SECRET popup Safari', null, array[v_att2]);
  perform public.support_update_ticket(v_t1, v_lepefy, 'low', v_lepefy, false, null, null, null);
  v_thread := public.support_tenant_thread(v_a, v_t1, v_admin_a);
  if v_thread::text like '%SECRET%' then raise exception 'internal note leaked to the tenant'; end if;
  if v_thread::text like '%' || v_att2::text || '%' then raise exception 'internal attachment leaked'; end if;
  if v_thread::text like '%priority%' or v_thread::text like '%assign%' then raise exception 'private fields leaked'; end if;
  if jsonb_array_length(v_thread->'messages') <> 2 then raise exception 'tenant thread should show two messages'; end if;
  if (select count(*) from public.support_tenant_ticket_page(v_a, v_admin_a, 'open', 'SECRET', 0, 20)) <> 0 then
    raise exception 'search reached internal notes';
  end if;
  if exists (select 1 from public.support_tenant_ticket_page(v_a, v_admin_a, 'open', null, 0, 50) where last_message_excerpt like '%SECRET%') then
    raise exception 'excerpt leaked an internal note';
  end if;
  -- Assignation à un non platform owner refusée.
  begin
    perform public.support_update_ticket(v_t1, v_lepefy, null, v_admin_a);
    raise exception 'tenant admin accepted as assignee';
  exception when others then if sqlerrm <> 'support_assignee_invalid' then raise; end if;
  end;

  -- ─── Réponse Lepefy : new → triaged, non lu pour la boutique ──────────────
  if public.support_tenant_unread_count(v_a, v_admin_a) <> 0 then raise exception 'unread before any reply'; end if;
  select out_status into v_status from public.support_post_message(v_t1, null, 'lepefy', v_lepefy, null, 'message', 'Pouvez-vous réessayer ?');
  if v_status <> 'triaged' then raise exception 'first reply should triage, got %', v_status; end if;
  perform 1 from public.support_tickets where id = v_t1 and first_response_at is not null and last_staff_reply_at is not null;
  if not found then raise exception 'first response not stamped'; end if;
  if public.support_tenant_unread_count(v_a, v_admin_a) <> 1 or public.support_tenant_unread_count(v_a, v_admin_a2) <> 1 then
    raise exception 'reply should be unread for each tenant admin';
  end if;
  perform public.support_mark_read(v_t1, v_a, v_admin_a, 'tenant');
  if public.support_tenant_unread_count(v_a, v_admin_a) <> 0 then raise exception 'read state not applied'; end if;
  if public.support_tenant_unread_count(v_a, v_admin_a2) <> 1 then raise exception 'read state must be per admin'; end if;

  -- « J'attends une réponse » puis message de la boutique → in_progress.
  select out_status into v_status from public.support_post_message(v_t1, null, 'lepefy', v_lepefy, null, 'message', 'Quel navigateur ?', null, null, true);
  if v_status <> 'waiting_tenant' then raise exception 'wait for tenant not applied'; end if;
  select out_status into v_status from public.support_post_message(v_t1, v_a, 'tenant', v_admin_a, 'Chloé', 'message', 'Safari sur iPhone');
  if v_status <> 'in_progress' then raise exception 'tenant answer should resume work, got %', v_status; end if;

  -- ─── Machine à états ──────────────────────────────────────────────────────
  begin
    perform public.support_set_status(v_t1, v_lepefy, 'new');
    raise exception 'transition back to new accepted';
  exception when others then if sqlerrm <> 'support_transition_invalid' then raise; end if;
  end;
  begin
    perform public.support_set_status(v_t1, v_lepefy, 'resolved', 'planned');
    raise exception 'stale expected status accepted';
  exception when others then if sqlerrm <> 'support_status_conflict' then raise; end if;
  end;
  begin
    perform public.support_record_feedback(v_t1, v_a, v_admin_a, true);
    raise exception 'feedback accepted before resolution';
  exception when others then if sqlerrm <> 'support_feedback_not_expected' then raise; end if;
  end;
  select out_status, out_changed into v_status, v_changed from public.support_set_status(v_t1, v_lepefy, 'resolved', 'in_progress');
  if v_status <> 'resolved' or not v_changed then raise exception 'resolve failed'; end if;
  select out_changed into v_changed from public.support_set_status(v_t1, v_lepefy, 'resolved');
  if v_changed then raise exception 'same status should be a no-op'; end if;

  -- « Non, j'ai encore un problème » → réouverture.
  select out_status into v_status from public.support_record_feedback(v_t1, v_a, v_admin_a, false);
  if v_status <> 'in_progress' then raise exception 'not solved should reopen'; end if;
  select out_changed into v_changed from public.support_record_feedback(v_t1, v_a, v_admin_a, false);
  if v_changed then raise exception 'double click should be a no-op'; end if;
  perform 1 from public.support_tickets where id = v_t1 and reopen_count = 1 and reopened_at is not null and resolved_at is null;
  if not found then raise exception 'reopen not recorded'; end if;

  -- Un message de la boutique sur une demande résolue la rouvre aussi.
  perform public.support_set_status(v_t1, v_lepefy, 'resolved');
  select out_status, out_reopened into v_status, v_reopened from public.support_post_message(v_t1, v_a, 'tenant', v_admin_a, 'Chloé', 'message', 'Toujours bloqué');
  if v_status <> 'in_progress' or not v_reopened then raise exception 'tenant message should reopen a resolved ticket'; end if;

  -- « Oui, merci » → closed ; plus de message boutique ensuite.
  perform public.support_set_status(v_t1, v_lepefy, 'resolved');
  select out_status into v_status from public.support_record_feedback(v_t1, v_a, v_admin_a, true);
  if v_status <> 'closed' then raise exception 'solved should close'; end if;
  begin
    perform public.support_post_message(v_t1, v_a, 'tenant', v_admin_a, 'Chloé', 'message', 'Encore');
    raise exception 'message accepted on a closed ticket';
  exception when others then if sqlerrm <> 'support_ticket_closed' then raise; end if;
  end;
  if (select count(*) from public.support_tenant_ticket_page(v_a, v_admin_a, 'done', null, 0, 20) where id = v_t1) <> 1 then
    raise exception 'closed ticket missing from the done view';
  end if;

  -- ─── Saisie manuelle (WhatsApp) : jamais attribuée à la boutique ──────────
  select out_ticket_id into v_imp
  from public.support_create_ticket(v_a, 'lepefy', v_lepefy, 'Équipe Lepefy', 'Frais de port Belgique',
    '[14/10 18:32] Chloé : les frais affichent 0 €', 'problem', false, 'normal', '{}'::jsonb, null, null, null,
    'whatsapp', 'wa-123', now() - interval '3 days', 'Chloé', false, null, null);
  perform 1 from public.support_messages where ticket_id = v_imp and author_type = 'lepefy' and relayed_from = 'whatsapp' and original_sent_at is not null;
  if not found then raise exception 'imported message must be relayed by Lepefy'; end if;
  perform 1 from public.support_tickets where id = v_imp and origin = 'platform_manual' and requester_admin_id is null and requester_label = 'Chloé';
  if not found then raise exception 'manual ticket fields wrong'; end if;
  if public.support_tenant_thread(v_a, v_imp, v_admin_a) is not null then raise exception 'hidden import visible to the tenant'; end if;
  perform public.support_update_ticket(v_imp, v_lepefy, null, null, false, null, null, true);
  if public.support_tenant_thread(v_a, v_imp, v_admin_a) is null then raise exception 'import not visible after publication'; end if;
  begin
    perform public.support_create_ticket(v_a, 'lepefy', v_lepefy, 'Équipe', 'Titre', 'Texte sans canal', 'problem', false, null,
      '{}'::jsonb, null, null, null, 'app');
    raise exception 'manual ticket accepted on the app channel';
  exception when others then if sqlerrm <> 'support_invalid_input' then raise; end if;
  end;

  -- ─── Fusion ───────────────────────────────────────────────────────────────
  begin
    perform public.support_merge_ticket(v_imp, v_nb, v_lepefy);
    raise exception 'cross-tenant merge accepted';
  exception when others then if sqlerrm <> 'support_merge_invalid' then raise; end if;
  end;
  perform public.support_merge_ticket(v_imp, v_n1, v_lepefy);
  perform 1 from public.support_tickets where id = v_imp and merged_into_ticket_id = v_t1 and status = 'closed';
  if not found then raise exception 'merge not applied'; end if;
  begin
    perform public.support_merge_ticket(v_imp, v_n1, v_lepefy);
    raise exception 'double merge accepted';
  exception when others then if sqlerrm <> 'support_merge_invalid' then raise; end if;
  end;

  -- ─── Liens GitHub ─────────────────────────────────────────────────────────
  begin
    perform public.support_add_link(v_t1, v_lepefy, 'issue', 'https://evil.example.com/a/b/issues/1');
    raise exception 'non GitHub link accepted';
  exception when others then if sqlerrm <> 'support_link_invalid' then raise; end if;
  end;
  select out_link_id into v_link from public.support_add_link(v_t1, v_lepefy, 'pull_request', 'https://github.com/lepefy-labs/lepefy-food-platform/pull/821', 'Fix PDF');
  select out_created into v_changed from public.support_add_link(v_t1, v_lepefy, 'pull_request', 'https://github.com/lepefy-labs/lepefy-food-platform/pull/821');
  if v_changed then raise exception 'duplicate link created'; end if;
  if public.support_tenant_thread(v_a, v_t1, v_admin_a)::text like '%github%' then raise exception 'GitHub link leaked'; end if;

  -- ─── Journal : évènements sans texte de message ───────────────────────────
  if not exists (select 1 from public.audit_events_test where event_type = 'support.ticket.created') then raise exception 'audit missing'; end if;
  if exists (select 1 from public.audit_events_test where (changes::text || metadata::text) like '%SECRET%' or (changes::text || metadata::text) like '%Safari%') then
    raise exception 'audit carries message text';
  end if;

  -- ─── File Lepefy ──────────────────────────────────────────────────────────
  if (select attention_rank from public.support_ticket_queue where id = v_tb) <> 1 then raise exception 'new ticket should rank 1'; end if;
  if (select attention_rank from public.support_ticket_queue where id = v_t1) <> 6 then raise exception 'closed ticket should rank last'; end if;

  -- ─── Capability, catalogue, IA ────────────────────────────────────────────
  if not exists (select 1 from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
                 where r.code = 'tenant_admin' and rp.permission_key = 'support.use') then
    raise exception 'support.use not granted to tenant_admin';
  end if;
  if exists (select 1 from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
             where r.code = 'tenant_cashier' and rp.permission_key = 'support.use') then
    raise exception 'support.use must not reach the cashier role';
  end if;
  if (select count(*) from public.audit_event_types where module = 'support') <> 6 then raise exception 'audit catalogue incomplete'; end if;
  if not exists (select 1 from public.ai_routing_policy_models pm join public.ai_routing_policies p on p.id = pm.policy_id
                 where p.consumer = 'support' and pm.timeout_ms <= 12000) then
    raise exception 'support AI route missing';
  end if;
  if exists (select 1 from storage.buckets where id = 'support-attachments' and public) then raise exception 'bucket must be private'; end if;
end $$;

-- ─── Privilèges : aucun accès navigateur ────────────────────────────────────
set role anon;
do $$ begin
  perform 1 from public.support_tickets;
  raise exception 'anon can read support_tickets';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.support_tenant_thread('10000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid());
  raise exception 'anon can execute support RPCs';
exception when insufficient_privilege then null;
end $$;
reset role;
set role authenticated;
do $$ begin
  perform 1 from public.support_messages;
  raise exception 'authenticated can read support_messages';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform 1 from public.support_ticket_queue;
  raise exception 'authenticated can read the queue';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.support_create_ticket('10000000-0000-4000-8000-000000000001', 'tenant', '20000000-0000-4000-8000-000000000002', 'x', 'x', 'xxxxx');
  raise exception 'authenticated can create tickets';
exception when insufficient_privilege then null;
end $$;
reset role;
set role service_role;
do $$ begin
  perform 1 from public.support_ticket_queue;
  perform public.support_tenant_unread_count('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');
end $$;
-- Le service role ne modifie pas une demande en direct : uniquement par les RPC.
do $$ begin
  update public.support_tickets set status = 'closed';
  raise exception 'service_role can update tickets directly';
exception when insufficient_privilege then null;
end $$;
reset role;
