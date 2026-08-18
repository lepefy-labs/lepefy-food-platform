-- ─── MIGRATION 064: TRANSPORT DU CONSENTEMENT CHECKOUT ──────────────────────
-- Ciclo 5/6 — eccezione esplicita alla regola "nessuna migration in questo
-- ciclo", concordata con Robertin: checkout_sessions non ha una colonna
-- adatta a trasportare i valori delle checkbox CGV/marketing dal submit del
-- form fino alla creazione effettiva dell'ordine (payment_intent.succeeded
-- o conferma manuale admin per external_link) — l'unico campo JSON libero
-- (shipping_details) viene copiato 1:1 in orders.shipping_details, mostrato
-- sia in admin sia al cliente, quindi inadatto. Stesso pattern già usato in
-- 059_external_payment_links.sql per un problema di trasporto identico.

alter table public.checkout_sessions
  add column if not exists consent_terms_accepted     boolean,
  add column if not exists consent_terms_doc_version   integer,
  add column if not exists consent_marketing_accepted  boolean;

comment on column public.checkout_sessions.consent_terms_accepted is
  'Case CGV cochée au moment du submit checkout — null si la case n''était pas affichée (utilisateur déjà à jour, Ciclo 5).';
comment on column public.checkout_sessions.consent_terms_doc_version is
  'Version de tenant_legal_documents (doc_type=terms) affichée/acceptée au moment du submit — à reporter telle quelle dans user_consents.doc_version.';
comment on column public.checkout_sessions.consent_marketing_accepted is
  'Case marketing cochée au moment du submit checkout — null si la case n''était pas affichée (consentement marketing déjà enregistré pour cet utilisateur).';

-- Aucun nouveau grant nécessaire : checkout_sessions a déjà
-- "grant all ... to service_role" (006_checkout_sessions.sql), qui couvre
-- automatiquement les nouvelles colonnes.
