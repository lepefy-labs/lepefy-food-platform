-- MIGRATION 076: protect server-only tenant configuration from public roles
--
-- RLS on tenants intentionally allows active tenant rows to be read publicly,
-- but RLS is row-level only: it does not hide sensitive columns. Historically
-- anon/authenticated therefore inherited table-level SELECT and could request
-- fields such as packlink_api_key directly through PostgREST.
--
-- Keep the existing active-row RLS policy, but replace table-level SELECT with
-- an explicit column allow-list. service_role keeps its existing full access.

revoke select on table public.tenants from anon, authenticated;

grant select (
  id,
  slug,
  name,
  tagline,
  logo_url,
  hero_image_url,
  primary_color,
  secondary_color,
  accent_light,
  city,
  country,
  currency,
  locale,
  click_collect_enabled,
  click_collect_address,
  google_maps_url,
  click_collect_hours,
  click_collect_hours_it,
  whatsapp_number,
  label_logo_url,
  legal_name,
  legal_address,
  legal_email,
  legal_website,
  active,
  storefront_ready,
  ai_image_generation,
  locales,
  ai_description_generation,
  ai_rate_limit_public_per_minute,
  ai_rate_limit_public_per_day,
  ai_semantic_search,
  ai_chatbox_enabled,
  catalogue_search_threshold,
  shipping_provider,
  flat_rate_amount,
  show_powered_by,
  story_heading,
  story_text,
  story_image_url,
  countries_served,
  loyalty_enabled,
  referral_max_depth,
  purchase_points_rate,
  points_to_currency_rate,
  referral_signup_bonus_points,
  referral_fraud_max_conversions,
  referral_fraud_period_days,
  referral_fraud_action,
  referral_availability_mode,
  referral_unlock_spending_threshold,
  ambassador_min_purchase_amount,
  ambassador_min_commission_amount,
  ambassador_max_commission_amount,
  ambassador_loyalty_from_second_order,
  ambassador_first_order_discount_type,
  ambassador_first_order_discount_value,
  ambassador_payout_threshold_amount,
  ambassador_commission_mode,
  ambassador_split_pool_amount,
  ambassador_split_pool_ambassador_percent,
  android_package_name,
  android_sha256_fingerprint,
  android_public,
  events_enabled,
  services_enabled,
  created_at,
  updated_at
) on table public.tenants to anon, authenticated;

comment on column public.tenants.packlink_api_key is
  'SERVER ONLY. Never grant SELECT to anon/authenticated; access through service-role server code only.';

comment on column public.tenants.chatbox_extra_context is
  'SERVER ONLY assistant context. Never serialize to storefront clients.';

comment on column public.tenants.stripe_account_id is
  'SERVER-SIDE payment configuration. Deliberately excluded from the public tenants column grant.';

comment on column public.tenants.ai_rate_limit_admin_per_day is
  'Internal admin limit. Deliberately excluded from the public tenants column grant.';