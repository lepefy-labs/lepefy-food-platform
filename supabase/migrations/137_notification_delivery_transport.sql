-- 137 — Transport metadata on notification deliveries (phase 3, Brevo API).
--
-- Additive, nullable: which transport handled the last attempt and the
-- provider message id (Brevo `messageId`), shown in Admin → Paramètres →
-- "Historique des envois" to look the email up in Brevo → Transactional → Logs.
-- The application writes these columns in a separate update, so it keeps
-- working before this migration is applied. Applying it twice is harmless.

alter table public.notification_deliveries
  add column if not exists transport text check (transport in ('n8n', 'brevo'));

alter table public.notification_deliveries
  add column if not exists provider_message_id text check (char_length(provider_message_id) <= 300);
