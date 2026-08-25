-- Event gallery photos explicitly approved for customer social sharing.
-- Additive and reversible: existing photos remain non-shareable by default.

alter table public.event_gallery_photos
  add column if not exists is_social_share boolean not null default false;

create index if not exists idx_event_gallery_photos_social_share
  on public.event_gallery_photos (tenant_id, event_id, sort_order)
  where is_social_share = true;

comment on column public.event_gallery_photos.is_social_share is
  'True when the photo is approved for the public event social-sharing flow.';
