-- Runs after 094, 096 and 129: add non-loyalty module rows and snapshot them.
insert into public.platform_features (key, name, category, active, billable, position)
values ('reviews', 'Avis vérifiés', 'growth', true, true, 60)
on conflict (key) do nothing;

insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config) values
  ('11111111-1111-4111-8111-111111111111', 'reviews', true, '{"public_display": true}'),
  ('22222222-2222-4222-8222-222222222222', 'daily_order_digest', true, '{"version": 1, "timezone": "Europe/Paris"}');

create table public._fixture_settings_before as
select tenant_id, feature_key, enabled, config, created_at, updated_at
from public.tenant_feature_settings;
