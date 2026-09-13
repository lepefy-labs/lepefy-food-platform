-- 108_tester_feedback_contact_status.sql
-- Optional tester contact metadata and manual installation tracking.
begin;

alter table public.tester_feedback_invites
  add column phone text,
  add column installation_status text not null default 'unknown',
  add constraint tester_feedback_invites_phone_check check (
    phone is null or (
      phone = btrim(phone)
      and char_length(phone) between 7 and 25
    )
  ),
  add constraint tester_feedback_invites_installation_status_check check (
    installation_status in ('unknown', 'installed', 'problem')
  );

comment on column public.tester_feedback_invites.phone is
  'Optional operational phone/WhatsApp contact for the tester. Not used as an authentication or Google Play identity signal.';

comment on column public.tester_feedback_invites.installation_status is
  'Manual operational installation status: unknown, installed, or problem. This is not authoritative Google Play telemetry.';

commit;
