-- MIGRATION 148: WHATSAPP — USERNAME / BSUID E MESSAGGI DALL'APP BUSINESS (coexistence)
--
-- Additiva e rieseguibile. Prerequisito: 147.
--
--   1. Business-scoped user ID (BSUID, `user_id` nei webhook Meta da aprile 2026):
--      un cliente che ha attivato lo username WhatsApp può arrivare SENZA numero
--      di telefono. La conversazione è identificata da wa_id (telefono) e/o
--      wa_user_id (BSUID, es. "IT.13491208655302741918"): almeno uno dei due.
--      wa_id / customer_phone diventano facoltativi, la coerenza resta vincolata.
--   2. Nuova firma di ingest_whatsapp_inbound_message con p_user_id: risoluzione
--      per BSUID, poi per telefono; completa l'identificativo mancante quando
--      arriva. La firma 147 resta (compatibilità durante il deploy) e delega.
--   3. ingest_whatsapp_business_echo: messaggio inviato dall'app WhatsApp Business
--      del tenant (webhook smb_message_echoes, coexistence). Registrato come
--      messaggio "équipe" in uscita, idempotente sul wamid, e mette in pausa
--      l'automazione della conversazione (un umano ha risposto dal telefono).
--
-- Rollback:
--   drop function if exists public.ingest_whatsapp_business_echo(uuid, text, text, text, text, text, jsonb, timestamptz, integer);
--   drop function if exists public.ingest_whatsapp_inbound_message(uuid, text, text, text, text, text, jsonb, timestamptz, text);
--   (147 ripristinabile solo se nessuna conversazione ha wa_id null)
--   alter table public.whatsapp_conversations drop constraint whatsapp_conversations_identity_check;
--   drop index if exists public.whatsapp_conversations_channel_user_key;
--   alter table public.whatsapp_conversations drop column if exists wa_user_id;

begin;

alter table public.whatsapp_conversations
  add column if not exists wa_user_id text;

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_wa_user_id_format;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_wa_user_id_format
  check (wa_user_id is null or wa_user_id ~ '^[A-Z]{2}(\.ENT)?\.[A-Za-z0-9]{1,128}$');

comment on column public.whatsapp_conversations.wa_user_id is
  'Business-scoped user ID (BSUID) Meta del cliente. Sempre presente nei webhook recenti; unico identificativo quando il cliente usa uno username e il telefono non è disponibile.';

alter table public.whatsapp_conversations alter column wa_id drop not null;
alter table public.whatsapp_conversations alter column customer_phone drop not null;

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_phone_matches_wa_id;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_phone_matches_wa_id
  check ((wa_id is null and customer_phone is null) or customer_phone = '+' || wa_id);

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_identity_check;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_identity_check
  check (wa_id is not null or wa_user_id is not null);

create unique index if not exists whatsapp_conversations_channel_user_key
  on public.whatsapp_conversations (channel_id, wa_user_id) where wa_user_id is not null;

-- Risoluzione/creazione della conversazione per un'identità cliente (BSUID e/o telefono).
create or replace function public.whatsapp_resolve_conversation(
  p_tenant_id uuid,
  p_channel_id uuid,
  p_wa_id text,
  p_user_id text,
  p_customer_name text,
  p_at timestamptz
)
returns table (out_conversation_id uuid, out_created boolean)
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
  v_wa_id text;
  v_user_id text;
  v_name text := nullif(left(btrim(coalesce(p_customer_name, '')), 120), '');
begin
  if p_wa_id is null and p_user_id is null then
    raise exception 'whatsapp_identity_missing';
  end if;

  if p_user_id is not null then
    select c.id, c.wa_id, c.wa_user_id into v_id, v_wa_id, v_user_id
    from public.whatsapp_conversations c
    where c.channel_id = p_channel_id and c.wa_user_id = p_user_id
    for update;
  end if;
  if v_id is null and p_wa_id is not null then
    select c.id, c.wa_id, c.wa_user_id into v_id, v_wa_id, v_user_id
    from public.whatsapp_conversations c
    where c.channel_id = p_channel_id and c.wa_id = p_wa_id
    for update;
  end if;

  if v_id is not null then
    -- Completa l'identificativo mancante (es. BSUID su una conversazione nata col solo telefono).
    update public.whatsapp_conversations c
    set wa_user_id = coalesce(c.wa_user_id, p_user_id),
        wa_id = coalesce(c.wa_id, p_wa_id),
        customer_phone = coalesce(c.customer_phone, case when p_wa_id is null then null else '+' || p_wa_id end),
        customer_name = coalesce(v_name, c.customer_name)
    where c.id = v_id
      and ((c.wa_user_id is null and p_user_id is not null)
        or (c.wa_id is null and p_wa_id is not null)
        or (v_name is not null and c.customer_name is distinct from v_name));
    return query select v_id, false;
    return;
  end if;

  begin
    insert into public.whatsapp_conversations (tenant_id, channel_id, wa_id, wa_user_id, customer_phone, customer_name, last_message_at)
    values (p_tenant_id, p_channel_id, p_wa_id, p_user_id,
            case when p_wa_id is null then null else '+' || p_wa_id end, v_name, coalesce(p_at, now()))
    returning id into v_id;
    return query select v_id, true;
  exception when unique_violation then
    -- Corsa tra due eventi dello stesso cliente: rilettura.
    select c.id into v_id
    from public.whatsapp_conversations c
    where c.channel_id = p_channel_id
      and ((p_user_id is not null and c.wa_user_id = p_user_id) or (p_wa_id is not null and c.wa_id = p_wa_id))
    limit 1;
    return query select v_id, false;
  end;
end;
$$;

create or replace function public.ingest_whatsapp_inbound_message(
  p_channel_id uuid,
  p_wa_id text,
  p_customer_name text,
  p_provider_message_id text,
  p_message_type text,
  p_body text,
  p_metadata jsonb,
  p_provider_timestamp timestamptz,
  p_user_id text
)
returns table (
  out_message_id uuid,
  out_conversation_id uuid,
  out_tenant_id uuid,
  out_created boolean,
  out_conversation_created boolean
)
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_tenant_id uuid;
  v_conversation_id uuid;
  v_conversation_created boolean;
  v_message_id uuid;
  v_received_at timestamptz := least(coalesce(p_provider_timestamp, now()), now());
begin
  select ch.tenant_id into v_tenant_id
  from public.tenant_whatsapp_channels ch
  where ch.id = p_channel_id and ch.status <> 'disabled';
  if v_tenant_id is null then
    raise exception 'whatsapp_channel_unavailable';
  end if;

  select m.id, m.conversation_id into v_message_id, v_conversation_id
  from public.whatsapp_messages m
  where m.channel_id = p_channel_id and m.provider_message_id = p_provider_message_id;
  if v_message_id is not null then
    return query select v_message_id, v_conversation_id, v_tenant_id, false, false;
    return;
  end if;

  select r.out_conversation_id, r.out_created into v_conversation_id, v_conversation_created
  from public.whatsapp_resolve_conversation(v_tenant_id, p_channel_id, p_wa_id, p_user_id, p_customer_name, v_received_at) r;

  insert into public.whatsapp_messages (
    tenant_id, conversation_id, channel_id, provider_message_id, direction, author_type,
    message_type, body, status, processing_status, metadata, provider_timestamp
  )
  values (
    v_tenant_id, v_conversation_id, p_channel_id, p_provider_message_id, 'inbound', 'customer',
    p_message_type, left(p_body, 4096), 'received', 'pending', coalesce(p_metadata, '{}'::jsonb), p_provider_timestamp
  )
  on conflict (channel_id, provider_message_id) where provider_message_id is not null do nothing
  returning id into v_message_id;

  if v_message_id is null then
    select m.id into v_message_id
    from public.whatsapp_messages m
    where m.channel_id = p_channel_id and m.provider_message_id = p_provider_message_id;
    return query select v_message_id, v_conversation_id, v_tenant_id, false, false;
    return;
  end if;

  update public.whatsapp_conversations c
  set last_message_at = greatest(c.last_message_at, v_received_at),
      last_inbound_at = greatest(coalesce(c.last_inbound_at, v_received_at), v_received_at),
      unread_count = c.unread_count + 1,
      status = case when c.status = 'closed' then 'open' else c.status end
  where c.id = v_conversation_id;

  return query select v_message_id, v_conversation_id, v_tenant_id, true, v_conversation_created;
end;
$$;

-- Messaggio scritto dall'équipe nell'app WhatsApp Business (coexistence).
-- Idempotente sul wamid; mette in pausa l'automazione: con auto-ripresa dopo
-- p_resume_minutes (null = ripresa manuale) e apre/accetta un handoff "agent_takeover".
create or replace function public.ingest_whatsapp_business_echo(
  p_channel_id uuid,
  p_wa_id text,
  p_user_id text,
  p_provider_message_id text,
  p_message_type text,
  p_body text,
  p_metadata jsonb,
  p_provider_timestamp timestamptz,
  p_resume_minutes integer
)
returns table (out_message_id uuid, out_conversation_id uuid, out_tenant_id uuid, out_created boolean)
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_tenant_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_created boolean;
  v_at timestamptz := least(coalesce(p_provider_timestamp, now()), now());
  v_resume_at timestamptz := case when p_resume_minutes is null then null else now() + make_interval(mins => p_resume_minutes) end;
begin
  select ch.tenant_id into v_tenant_id
  from public.tenant_whatsapp_channels ch
  where ch.id = p_channel_id and ch.status <> 'disabled';
  if v_tenant_id is null then
    raise exception 'whatsapp_channel_unavailable';
  end if;

  select m.id, m.conversation_id into v_message_id, v_conversation_id
  from public.whatsapp_messages m
  where m.channel_id = p_channel_id and m.provider_message_id = p_provider_message_id;
  if v_message_id is not null then
    return query select v_message_id, v_conversation_id, v_tenant_id, false;
    return;
  end if;

  select r.out_conversation_id into v_conversation_id
  from public.whatsapp_resolve_conversation(v_tenant_id, p_channel_id, p_wa_id, p_user_id, null, v_at) r;

  insert into public.whatsapp_messages (
    tenant_id, conversation_id, channel_id, provider_message_id, direction, author_type,
    message_type, body, status, metadata, provider_timestamp, sent_at
  )
  values (
    v_tenant_id, v_conversation_id, p_channel_id, p_provider_message_id, 'outbound', 'agent',
    p_message_type, left(p_body, 4096), 'sent',
    coalesce(p_metadata, '{}'::jsonb) || '{"source":"business_app"}'::jsonb, p_provider_timestamp, v_at
  )
  on conflict (channel_id, provider_message_id) where provider_message_id is not null do nothing
  returning id into v_message_id;
  v_created := v_message_id is not null;

  if not v_created then
    select m.id into v_message_id
    from public.whatsapp_messages m
    where m.channel_id = p_channel_id and m.provider_message_id = p_provider_message_id;
    return query select v_message_id, v_conversation_id, v_tenant_id, false;
    return;
  end if;

  update public.whatsapp_conversations c
  set last_message_at = greatest(c.last_message_at, v_at),
      status = 'human',
      automation_status = 'paused',
      human_handoff_at = coalesce(c.human_handoff_at, v_at),
      automation_resume_at = v_resume_at,
      unread_count = 0
  where c.id = v_conversation_id;

  update public.whatsapp_handoffs h
  set accepted_at = coalesce(h.accepted_at, v_at), resume_automation_at = v_resume_at
  where h.conversation_id = v_conversation_id and h.resolved_at is null;
  if not found then
    insert into public.whatsapp_handoffs (tenant_id, conversation_id, reason, accepted_at, resume_automation_at, metadata)
    values (v_tenant_id, v_conversation_id, 'agent_takeover', v_at, v_resume_at, '{"source":"business_app"}'::jsonb);
  end if;

  insert into public.whatsapp_audit_events (tenant_id, conversation_id, event_type, actor_type, detail)
  values (v_tenant_id, v_conversation_id, 'business_app_reply', 'system',
          jsonb_build_object('auto_resume_minutes', p_resume_minutes));

  return query select v_message_id, v_conversation_id, v_tenant_id, true;
end;
$$;

revoke all on function public.whatsapp_resolve_conversation(uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.ingest_whatsapp_inbound_message(uuid, text, text, text, text, text, jsonb, timestamptz, text) from public, anon, authenticated;
revoke all on function public.ingest_whatsapp_business_echo(uuid, text, text, text, text, text, jsonb, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.whatsapp_resolve_conversation(uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.ingest_whatsapp_inbound_message(uuid, text, text, text, text, text, jsonb, timestamptz, text) to service_role;
grant execute on function public.ingest_whatsapp_business_echo(uuid, text, text, text, text, text, jsonb, timestamptz, integer) to service_role;

commit;
