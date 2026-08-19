-- ─── MIGRATION 067: CHECKOUT SESSIONS MODIFIABLES IN PLACE ──────────────────
-- Fondamenta condivise per rendere checkout_sessions un'entità che il
-- cliente può riprendere e modificare (items/indirizzo/metodo di pagamento)
-- prima del pagamento, invece di una riga "usa e getta" cancellata solo dal
-- webhook Stripe / dalla conferma admin (createOrderFromCheckoutSession).
-- Questa migration aggiunge solo colonne/indici — nessuna UI in questo giro.

-- status: distingue le sessioni ancora valide da quelle esplicitamente
-- annullate dal cliente (es. ha scelto di cambiare metodo di pagamento e
-- creato/aggiornato una nuova richiesta). Le righe con status='open' sono
-- quelle mostrate come "en attente" al cliente; 'cancelled' resta per audit
-- ma non deve più comparire in nessuna lista customer-facing.
alter table public.checkout_sessions
  add column if not exists status text not null default 'open'
    check (status in ('open', 'cancelled'));

-- Necessario per annullare/aggiornare il PaymentIntent quando la sessione
-- viene modificata (importo cambiato) o quando il cliente cambia metodo di
-- pagamento (stripe → external_link): senza questo campo l'id esiste solo
-- nei metadata Stripe, mai recuperabile lato nostro DB.
alter table public.checkout_sessions
  add column if not exists stripe_payment_intent_id text;

create unique index if not exists checkout_sessions_stripe_payment_intent_id_uniq
  on public.checkout_sessions (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- Query "le mie sessioni in sospeso" (customer loggato), usata dal prompt
-- successivo per la sezione "En attente" su /orders.
create index if not exists idx_checkout_sessions_customer_status
  on public.checkout_sessions (tenant_id, customer_id, status, created_at desc)
  where customer_id is not null;

comment on column public.checkout_sessions.status is
  'open = sessione valida e modificabile/riprendibile ; cancelled = annullata esplicitamente dal cliente (audit only, non mostrata).';
comment on column public.checkout_sessions.stripe_payment_intent_id is
  'PaymentIntent Stripe associato a questa sessione (branche payment_method=stripe con intent già créé). Null per external_link o se il PaymentIntent non è ancora stato creé (flux différé, cf. StripePaymentStep).';

-- Nessun nuovo grant necessario: checkout_sessions ha già
-- "grant all ... to service_role" (006_checkout_sessions.sql), che copre
-- automaticamente le nuove colonne.
