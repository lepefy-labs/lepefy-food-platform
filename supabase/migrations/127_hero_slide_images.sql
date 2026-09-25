-- Optional editorial artwork for the storefront "Découvrir" hero.
-- Dynamic offer, arrival, event and service slides resolve their visual from
-- their source records at render time; this column is for tenant-managed
-- editorial slides only.
alter table public.tenant_hero_slides
  add column if not exists image_url text;

comment on column public.tenant_hero_slides.image_url is
  'Optional public image URL used by the editorial home hero slide.';
