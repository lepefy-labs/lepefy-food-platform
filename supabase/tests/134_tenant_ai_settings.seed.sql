-- Runs after the chain up to 133 (current production state): snapshot every
-- module row so the test proves 134 only adds 'ai' rows and Nala contexts.
create table public._fixture_settings_before_134 as
select tenant_id, feature_key, enabled, config, created_at, updated_at
from public.tenant_feature_settings;
