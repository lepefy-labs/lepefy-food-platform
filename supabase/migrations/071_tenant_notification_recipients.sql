-- ─── MIGRATION 071: DESTINATARI NOTIFICHE INTERNE AL TENANT ─────────────────
-- Tabella generica e multi-tenant per gestire le email "back office" (staff/
-- proprietario del negozio, non i clienti) che devono ricevere notifiche
-- interne (es. pagamento Card riuscito, futuro conflitto stock ordine).
-- Un flag booleano per tipo di notifica, invece di una tabella per modulo
-- (decisione esplicita con Robertin: qui il destinatario è concettualmente
-- "il tenant", condiviso tra più tipi di alert, a differenza di domini come
-- orders/event_reservations che restano separati per modulo).

create table if not exists public.tenant_notification_recipients (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  email                       text not null,
  label                       text,
  notify_card_payment         boolean not null default true,
  notify_order_stock_conflict boolean not null default false,
  active                      boolean not null default true,
  created_at                  timestamptz not null default now(),
  unique (tenant_id, email)
);

create index if not exists idx_tenant_notification_recipients_tenant
  on public.tenant_notification_recipients(tenant_id);

comment on table public.tenant_notification_recipients is
  'Email interne al tenant (staff/proprietario) da notificare su eventi di backoffice. Un flag booleano per tipo di notifica (notify_*). notify_order_stock_conflict riservato, non ancora wire-ato a nessun webhook.';

alter table public.tenant_notification_recipients enable row level security;

-- RLS senza policy pubbliche: lettura/scrittura solo service_role, stesso
-- pattern di tenant_card_payments (062). Le route admin usano
-- createServiceClient() + requireAdmin(tenant.id) per l'autorizzazione reale.
grant select, insert, update, delete on public.tenant_notification_recipients to service_role;
