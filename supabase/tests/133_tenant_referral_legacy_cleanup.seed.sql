-- Runs after the 132 chain (current production state): snapshot every module
-- row so the test proves 133 only removes legacy columns and triggers.
create table public._fixture_settings_before_133 as
select tenant_id, feature_key, enabled, config, created_at, updated_at
from public.tenant_feature_settings;
