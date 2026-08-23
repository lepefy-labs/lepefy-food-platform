-- MIGRATION 071: PLATFORM-LEVEL ADMIN BRANDING
-- Separate the SaaS admin visual identity from tenant storefront branding.
-- One singleton row configures platform colors/logo used by /admin/**.

create table if not exists public.platform_branding (
  id text primary key default 'default' check (id = 'default'),
  platform_name text not null default 'Lepefy',
  logo_url text,
  primary_color text not null default '#6D5AF6',
  primary_hover text not null default '#5B49E8',
  primary_soft text not null default '#F3F1FF',
  primary_foreground text not null default '#4434C7',
  surface_color text not null default '#FFFFFF',
  surface_subtle text not null default '#FAFAFC',
  page_background text not null default '#F7F8FA',
  border_color text not null default '#E5E7EB',
  updated_at timestamptz not null default now()
);

comment on table public.platform_branding is
  'Singleton platform-level branding for Lepefy admin UI. Tenant branding remains separate and continues to drive storefront experiences.';

insert into public.platform_branding (id)
values ('default')
on conflict (id) do nothing;

alter table public.platform_branding enable row level security;

-- No browser-facing policy is intentionally created. Server-side admin layouts
-- read this singleton through the service-role client. Future platform-owner
-- editing should go through a protected server route, never a public table write.

grant select, insert, update on public.platform_branding to service_role;
