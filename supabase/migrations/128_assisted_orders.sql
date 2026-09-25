-- MIGRATION 128: commandes assistées (WhatsApp / téléphone / Instagram / magasin)
--
-- Additive. Invariant inchangé : aucune ligne `orders` avant paiement confirmé.
-- Un achat saisi par l'équipe est une checkout_session `origin = 'assisted'`
-- (brouillon → lien de paiement → paiement à vérifier) ; seule la conversion
-- atomique `convert_checkout_session_to_order` crée la commande, une seule fois.
--
-- Runbook, vérifications post-application et rollback : docs/ASSISTED_ORDERS.md.

-- ─── checkout_sessions : origine, canal, lien de paiement, audit ─────────────

-- Un client WhatsApp peut n'avoir qu'un téléphone : l'e-mail devient facultatif
-- pour les seules sessions assistées (contrainte ci-dessous). Aucune adresse
-- n'est inventée pour satisfaire le schéma.
alter table public.checkout_sessions alter column email drop not null;

alter table public.checkout_sessions
  add column if not exists origin text not null default 'storefront',
  add column if not exists sales_channel text,
  add column if not exists created_by_admin_id uuid references public.admin_users(id) on delete set null,
  add column if not exists admin_note text,
  add column if not exists notify_customer boolean not null default true,
  add column if not exists request_key uuid,
  add column if not exists pay_token_hash text,
  add column if not exists pay_token_nonce text,
  add column if not exists pay_token_issued_at timestamptz,
  add column if not exists pay_link_version integer not null default 0,
  add column if not exists declared_payment_at timestamptz,
  add column if not exists declared_payment_reference text;

alter table public.checkout_sessions drop constraint if exists checkout_sessions_origin_check;
alter table public.checkout_sessions
  add constraint checkout_sessions_origin_check check (origin in ('storefront', 'assisted'));

alter table public.checkout_sessions drop constraint if exists checkout_sessions_sales_channel_check;
alter table public.checkout_sessions
  add constraint checkout_sessions_sales_channel_check
  check (sales_channel is null or sales_channel in ('whatsapp', 'phone', 'instagram', 'in_store', 'other'));

-- Le storefront garde l'e-mail obligatoire ; une session assistée exige au
-- moins un moyen de contact.
alter table public.checkout_sessions drop constraint if exists checkout_sessions_contact_check;
alter table public.checkout_sessions
  add constraint checkout_sessions_contact_check
  check (
    (origin = 'storefront' and email is not null)
    or (origin = 'assisted' and (email is not null or phone is not null))
  );

-- `draft` : précommande en cours de saisie, jamais payable ni expirée.
alter table public.checkout_sessions drop constraint if exists checkout_sessions_status_check;
alter table public.checkout_sessions
  add constraint checkout_sessions_status_check
  check (status in ('draft', 'open', 'awaiting_verification', 'completed', 'cancelled', 'expired'));

alter table public.checkout_sessions drop constraint if exists checkout_sessions_draft_assisted_check;
alter table public.checkout_sessions
  add constraint checkout_sessions_draft_assisted_check
  check (status <> 'draft' or origin = 'assisted');

create unique index if not exists checkout_sessions_pay_token_hash_uniq
  on public.checkout_sessions (pay_token_hash)
  where pay_token_hash is not null;

-- Idempotence de la saisie admin : un double clic ou un retry réseau renvoie
-- la même précommande au lieu d'en créer une seconde.
create unique index if not exists checkout_sessions_assisted_request_key_uniq
  on public.checkout_sessions (tenant_id, request_key)
  where request_key is not null;

create index if not exists idx_checkout_sessions_assisted
  on public.checkout_sessions (tenant_id, status, created_at desc)
  where origin = 'assisted';

-- Le panier récupérable « un seul par client » ne concerne que le storefront :
-- une précommande assistée ne doit ni bloquer ni écraser le panier du client.
drop index if exists public.checkout_sessions_one_open_per_customer;
create unique index checkout_sessions_one_open_per_customer
  on public.checkout_sessions (tenant_id, customer_id)
  where customer_id is not null and status = 'open' and origin = 'storefront';

comment on column public.checkout_sessions.origin is
  'storefront = achat autonome du client ; assisted = saisi par l''équipe (commande assistée).';
comment on column public.checkout_sessions.sales_channel is
  'Canal commercial d''une commande assistée : whatsapp | phone | instagram | in_store | other.';
comment on column public.checkout_sessions.pay_token_hash is
  'SHA-256 du jeton opaque /pay/<token>. Le jeton lui-même n''est jamais stocké.';
comment on column public.checkout_sessions.pay_token_nonce is
  'Nonce aléatoire du lien courant ; le remplacer révoque immédiatement l''ancien lien.';
comment on column public.checkout_sessions.notify_customer is
  'Commande assistée : envoyer (true) ou non le récapitulatif e-mail order-confirmed à la conversion.';

-- Les sessions assistées ont leur propre historique (assisted_order_events) :
-- elles ne polluent ni payment_funnel_logs ni l'entonnoir storefront.
create or replace function public.log_checkout_lifecycle_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status and coalesce(new.origin, 'storefront') = 'storefront' then
    insert into public.payment_funnel_logs(tenant_id, module, reference_id, event_type, detail)
    values (
      new.tenant_id,
      'shop',
      new.id,
      case new.status
        when 'completed' then 'checkout_completed'
        when 'cancelled' then 'checkout_cancelled'
        when 'expired' then 'checkout_expired'
        when 'awaiting_verification' then 'external_payment_awaiting_verification'
        else 'checkout_reused'
      end,
      jsonb_build_object('previous_status', old.status, 'order_id', new.order_id)
    );
  end if;
  return new;
end;
$$;

drop view if exists public.checkout_funnel_30d;

create view public.checkout_funnel_30d as
select
  tenant_id,
  count(*) filter (where created_at >= now() - interval '30 days') as checkout_started,
  count(*) filter (where created_at >= now() - interval '30 days' and status = 'completed') as checkout_completed,
  count(*) filter (where created_at >= now() - interval '30 days' and status = 'open') as checkout_open,
  count(*) filter (where created_at >= now() - interval '30 days' and status = 'awaiting_verification') as checkout_awaiting_verification,
  count(*) filter (where created_at >= now() - interval '30 days' and status = 'expired') as checkout_expired,
  count(*) filter (where created_at >= now() - interval '30 days' and status = 'cancelled') as checkout_cancelled,
  count(*) filter (where created_at >= now() - interval '30 days' and resume_count > 0) as checkout_resumed,
  count(*) filter (where created_at >= now() - interval '30 days' and resume_count > 0 and status = 'completed') as checkout_recovered
from public.checkout_sessions
where origin = 'storefront'
group by tenant_id;

grant select on public.checkout_funnel_30d to service_role;

-- ─── orders : origine, canal, traçabilité de l'encaissement ─────────────────

alter table public.orders alter column email drop not null;

alter table public.orders
  add column if not exists order_origin text not null default 'storefront',
  add column if not exists sales_channel text,
  add column if not exists checkout_session_id uuid references public.checkout_sessions(id) on delete set null,
  add column if not exists created_by_admin_id uuid references public.admin_users(id) on delete set null,
  add column if not exists payment_confirmation_source text,
  add column if not exists payment_received_at timestamptz,
  add column if not exists payment_reference text,
  add column if not exists payment_confirmed_by uuid references public.admin_users(id) on delete set null,
  add column if not exists payment_note text;

alter table public.orders drop constraint if exists orders_order_origin_check;
alter table public.orders
  add constraint orders_order_origin_check check (order_origin in ('storefront', 'assisted'));

alter table public.orders drop constraint if exists orders_sales_channel_check;
alter table public.orders
  add constraint orders_sales_channel_check
  check (sales_channel is null or sales_channel in ('whatsapp', 'phone', 'instagram', 'in_store', 'other'));

alter table public.orders drop constraint if exists orders_contact_check;
alter table public.orders
  add constraint orders_contact_check check (email is not null or order_origin = 'assisted');

-- stripe_webhook = confirmé automatiquement par Stripe ;
-- admin_verified = paiement externe déclaré puis vérifié par l'équipe ;
-- admin_recorded = encaissement déjà reçu, enregistré par l'équipe.
alter table public.orders drop constraint if exists orders_payment_confirmation_source_check;
alter table public.orders
  add constraint orders_payment_confirmation_source_check
  check (payment_confirmation_source is null
    or payment_confirmation_source in ('stripe_webhook', 'admin_verified', 'admin_recorded'));

alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method in ('stripe', 'satispay', 'cash', 'in_store', 'external_link', 'manual'));

-- Garantie de base de données : une checkout_session produit au plus une commande.
create unique index if not exists orders_checkout_session_id_uniq
  on public.orders (checkout_session_id)
  where checkout_session_id is not null;

create index if not exists idx_orders_assisted
  on public.orders (tenant_id, created_at desc)
  where order_origin = 'assisted';

comment on column public.orders.order_origin is
  'storefront = commande passée par le client ; assisted = saisie par l''équipe.';
comment on column public.orders.checkout_session_id is
  'Checkout session convertie en cette commande (unique) — clé d''idempotence de la conversion.';
comment on column public.orders.payment_confirmation_source is
  'Qui a confirmé le paiement : stripe_webhook, admin_verified ou admin_recorded.';

-- ─── Historique / audit des commandes assistées ──────────────────────────────

create table if not exists public.assisted_order_events (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete cascade,
  order_id            uuid references public.orders(id) on delete set null,
  event_type          text not null check (event_type in (
    'created', 'updated', 'link_issued', 'link_revoked', 'link_opened',
    'payment_declared', 'payment_confirmed', 'order_created', 'reopened',
    'cancelled', 'expired', 'stock_conflict', 'duplicate_payment', 'amount_mismatch',
    'notification_sent', 'notification_skipped'
  )),
  actor_type          text not null check (actor_type in ('admin', 'customer', 'system')),
  actor_admin_id      uuid references public.admin_users(id) on delete set null,
  detail              jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists idx_assisted_order_events_session
  on public.assisted_order_events (tenant_id, checkout_session_id, created_at);

alter table public.assisted_order_events enable row level security;
revoke all on public.assisted_order_events from anon, authenticated;
grant all on public.assisted_order_events to service_role;

comment on table public.assisted_order_events is
  'Journal append-only des commandes assistées (création, liens, paiements, conversion). Service-role uniquement.';

-- ─── Conversion atomique et idempotente session → commande ───────────────────
--
-- Un seul appel gagnant par session : verrou de ligne FOR UPDATE, puis
-- commande + lignes + décrément de stock + clôture de la session dans la même
-- transaction. Les appels concurrents ou rejoués (webhook dupliqué, double
-- confirmation admin) retournent la commande existante avec created = false,
-- ce qui permet à l'application de n'émettre les effets de bord qu'une fois.
-- Stock insuffisant au moment du paiement : les décréments sont annulés
-- (sous-transaction) et la commande est créée en `stock_conflict`, comme le
-- flux historique, pour remboursement / intervention manuelle.
create or replace function public.convert_checkout_session_to_order(
  p_tenant_id uuid,
  p_session_id uuid,
  p_payment jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  s              public.checkout_sessions%rowtype;
  v_source       text := p_payment->>'source';
  v_method       text := p_payment->>'payment_method';
  v_allowed      text[];
  v_order_id     uuid;
  v_order_status text;
  v_subtotal     numeric(10, 2);
  v_total        numeric(10, 2);
  v_stock_items  jsonb;
  v_conflict     boolean := false;
  v_stock_error  text;
  v_now          timestamptz := now();
begin
  if v_source is null or v_source not in ('stripe_webhook', 'admin_verified', 'admin_recorded') then
    raise exception 'invalid_payment_source';
  end if;
  if v_method is null or v_method not in ('stripe', 'external_link', 'manual') then
    raise exception 'invalid_payment_method';
  end if;
  if v_source = 'stripe_webhook' and coalesce(p_payment->>'stripe_payment_intent_id', '') = '' then
    raise exception 'missing_payment_intent';
  end if;

  select * into s
  from public.checkout_sessions
  where id = p_session_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'session_not_found';
  end if;

  if s.order_id is not null then
    select status into v_order_status from public.orders where id = s.order_id;
    return jsonb_build_object('order_id', s.order_id, 'created', false,
      'stock_conflict', coalesce(v_order_status = 'stock_conflict', false));
  end if;

  select id, status into v_order_id, v_order_status
  from public.orders
  where checkout_session_id = s.id
  limit 1;
  if v_order_id is not null then
    update public.checkout_sessions
    set status = 'completed', order_id = v_order_id, completed_at = coalesce(completed_at, v_now), updated_at = v_now
    where id = s.id;
    return jsonb_build_object('order_id', v_order_id, 'created', false,
      'stock_conflict', v_order_status = 'stock_conflict');
  end if;

  -- Un paiement Stripe capturé doit toujours aboutir à une commande (même si la
  -- session a été annulée ou a expiré entre-temps) ; une confirmation manuelle
  -- ne peut jamais ressusciter une session annulée.
  v_allowed := case v_source
    when 'stripe_webhook' then array['open', 'awaiting_verification', 'expired', 'cancelled']
    when 'admin_verified' then array['open', 'awaiting_verification', 'expired']
    else array['draft', 'open', 'awaiting_verification', 'expired']
  end;
  if not (s.status = any (v_allowed)) then
    raise exception 'session_not_convertible:%', s.status;
  end if;

  if jsonb_typeof(s.items) is distinct from 'array' or jsonb_array_length(s.items) = 0 then
    raise exception 'session_items_empty';
  end if;

  select round(coalesce(sum((i->>'price')::numeric * (i->>'quantity')::integer), 0), 2)
  into v_subtotal
  from jsonb_array_elements(s.items) i;
  v_total := round(v_subtotal + coalesce(s.shipping_total, 0) - coalesce(s.ambassador_discount_amount, 0), 2);

  select coalesce(jsonb_agg(jsonb_build_object('product_id', t.product_id, 'quantity', t.quantity)), '[]'::jsonb)
  into v_stock_items
  from (
    select (i->>'productId')::uuid as product_id, sum((i->>'quantity')::integer) as quantity
    from jsonb_array_elements(s.items) i
    where nullif(i->>'productId', '') is not null
    group by 1
  ) t;

  begin
    perform public.decrement_stock_for_order(v_stock_items);
  exception when others then
    v_conflict := true;
    v_stock_error := sqlerrm;
  end;

  insert into public.orders (
    tenant_id, customer_id, email, full_name, fulfillment_type, shipping_address, shipping_details,
    subtotal, shipping_cost, total, ambassador_discount_amount,
    payment_method, payment_status, stripe_payment_intent_id,
    external_payment_type, external_payment_label,
    status, notes,
    order_origin, sales_channel, checkout_session_id, created_by_admin_id,
    payment_confirmation_source, payment_received_at, payment_reference, payment_confirmed_by, payment_note
  ) values (
    s.tenant_id, s.customer_id, s.email, s.full_name, s.fulfillment_type, s.shipping_address, s.shipping_details,
    v_subtotal, coalesce(s.shipping_total, 0), v_total, coalesce(s.ambassador_discount_amount, 0),
    v_method,
    -- Historique : un conflit de stock sur un paiement non-Stripe reste « pending »
    -- (remboursement manuel à faire), Stripe reste « paid » jusqu'au remboursement.
    case when v_conflict and v_source <> 'stripe_webhook' then 'pending' else 'paid' end,
    nullif(p_payment->>'stripe_payment_intent_id', ''),
    case when v_method = 'stripe' then null else coalesce(nullif(p_payment->>'external_payment_type', ''), s.external_payment_type) end,
    case when v_method = 'stripe' then null else coalesce(nullif(p_payment->>'external_payment_label', ''), s.external_payment_label) end,
    case when v_conflict then 'stock_conflict' else 'preparing' end,
    case when s.phone is not null then 'Téléphone: ' || s.phone else null end,
    s.origin, s.sales_channel, s.id, s.created_by_admin_id,
    v_source,
    coalesce(nullif(p_payment->>'received_at', '')::timestamptz, v_now),
    nullif(p_payment->>'reference', ''),
    nullif(p_payment->>'confirmed_by', '')::uuid,
    nullif(p_payment->>'note', '')
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, tenant_id, product_id, name, price, quantity, subtotal, storage_type)
  select
    v_order_id,
    s.tenant_id,
    nullif(i->>'productId', '')::uuid,
    i->>'name',
    (i->>'price')::numeric,
    (i->>'quantity')::integer,
    round((i->>'price')::numeric * (i->>'quantity')::integer, 2),
    coalesce(nullif(i->>'storage_type', ''), 'dry')
  from jsonb_array_elements(s.items) i;

  update public.checkout_sessions
  set status = 'completed',
      order_id = v_order_id,
      completed_at = v_now,
      last_activity_at = v_now,
      updated_at = v_now
  where id = s.id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'created', true,
    'stock_conflict', v_conflict,
    'stock_error', v_stock_error,
    'total', v_total
  );
end;
$$;

comment on function public.convert_checkout_session_to_order(uuid, uuid, jsonb) is
  'Conversion atomique et idempotente d''une checkout_session payée en commande. Service-role uniquement.';

-- Les fonctions sont exécutables par PUBLIC par défaut : on restreint explicitement.
revoke all on function public.convert_checkout_session_to_order(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.convert_checkout_session_to_order(uuid, uuid, jsonb) to service_role;

-- ─── Rollback (manuel, uniquement si aucune commande assistée n'existe) ──────
-- drop function if exists public.convert_checkout_session_to_order(uuid, uuid, jsonb);
-- drop table if exists public.assisted_order_events;
-- drop index if exists public.orders_checkout_session_id_uniq;
-- drop index if exists public.idx_orders_assisted;
-- alter table public.orders drop constraint if exists orders_contact_check,
--   drop constraint if exists orders_order_origin_check, drop constraint if exists orders_sales_channel_check,
--   drop constraint if exists orders_payment_confirmation_source_check;
-- alter table public.orders drop column if exists order_origin, drop column if exists sales_channel,
--   drop column if exists checkout_session_id, drop column if exists created_by_admin_id,
--   drop column if exists payment_confirmation_source, drop column if exists payment_received_at,
--   drop column if exists payment_reference, drop column if exists payment_confirmed_by, drop column if exists payment_note;
-- (rétablir orders_payment_method_check sans 'manual', puis email NOT NULL si aucune ligne nulle)
-- drop index if exists public.checkout_sessions_one_open_per_customer;
-- create unique index checkout_sessions_one_open_per_customer on public.checkout_sessions (tenant_id, customer_id)
--   where customer_id is not null and status = 'open';
-- (supprimer les colonnes assistées de checkout_sessions, rétablir le CHECK de statut 075 et la vue 075)
