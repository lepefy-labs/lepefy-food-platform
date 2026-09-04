-- Fixture for migration 102. The CI database already has roles + tenants from 100_ai_core.fixture.sql.
create table if not exists public.tenant_knowledge_base (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category text not null default 'faq',
  content text not null,
  reviewed_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.tenant_knowledge_base(id, tenant_id, category, content, reviewed_at)
values (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  'faq',
  'Knowledge fixture',
  now() - interval '1 day'
);
