-- Runs after the real 094 and 096: add another module with a JSONB config
-- (as 113 reviews does) and snapshot every existing module setting so the
-- test can prove 129 leaves them untouched.
insert into public.platform_features (key, name, category, active, billable, position)
values ('reviews', 'Avis vérifiés', 'growth', true, true, 60)
on conflict (key) do nothing;

insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config) values
  ('11111111-1111-4111-8111-111111111111', 'reviews', true, '{"public_display": true, "min_public_count": 3}');

update public.tenant_feature_settings
set config = '{"tone": "warm"}'
where tenant_id = '22222222-2222-4222-8222-222222222222' and feature_key = 'nala';

create table public._fixture_settings_before as
select tenant_id, feature_key, enabled, config, created_at, updated_at
from public.tenant_feature_settings;
