-- Editorial library for the whole Evenementiel module.
-- Additive: no event association, sharing flag, sort order or RLS is changed.
begin;

alter table public.event_gallery_photos
  add column category text,
  add column hero_eligible boolean not null default false,
  add column hero_priority smallint not null default 50;

update public.event_gallery_photos
set category = case when event_id is not null then 'event' else 'general' end;

alter table public.event_gallery_photos
  alter column category set default 'general',
  alter column category set not null,
  add constraint event_gallery_photos_category_check
    check (category in ('event', 'traiteur', 'location_materiel', 'ambiance', 'general')),
  add constraint event_gallery_photos_hero_priority_check
    check (hero_priority between 0 and 100);

create index idx_event_gallery_photos_hero
  on public.event_gallery_photos (tenant_id, category, hero_priority desc, sort_order, id)
  where hero_eligible = true;

commit;

-- Practical rollback (editorial metadata is lost; original gallery data is kept):
-- begin;
-- drop index public.idx_event_gallery_photos_hero;
-- alter table public.event_gallery_photos
--   drop column category, drop column hero_eligible, drop column hero_priority;
-- commit;
