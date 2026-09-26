-- Runs after 094 -> 096 -> 129 -> 130 seed -> 130 -> 131 (current production
-- state): snapshot every module row so the test proves 132 leaves them alone.
create table public._fixture_settings_before_132 as
select tenant_id, feature_key, enabled, config, created_at, updated_at
from public.tenant_feature_settings;
