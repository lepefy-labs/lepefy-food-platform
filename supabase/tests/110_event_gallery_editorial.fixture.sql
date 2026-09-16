-- Isolated CI fixture: original gallery contract, including migration 081.
create table public.event_gallery_photos (
  id uuid primary key,
  tenant_id uuid not null,
  event_id uuid,
  image_url text not null,
  caption text,
  sort_order integer not null default 0,
  is_social_share boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.event_gallery_photos enable row level security;
create policy event_gallery_photos_select_public on public.event_gallery_photos for select using (true);
insert into public.event_gallery_photos (id, tenant_id, event_id, image_url, caption, sort_order, is_social_share)
values
  ('00000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'https://images.example/event', 'Event', 3, true),
  ('00000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, 'https://images.example/general', 'General', 7, false),
  ('00000000-0000-0000-0000-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', null, 'https://images.example/other-tenant', null, 0, false);
create table public.gallery_editorial_before as select * from public.event_gallery_photos;
