-- Provider-neutral operational shipping snapshot. No historical backfill.
BEGIN;
ALTER TABLE public.orders
  ADD COLUMN shipping_tracking_mode text CHECK (shipping_tracking_mode IN ('managed', 'manual')),
  ADD COLUMN shipping_provider_key text,
  ADD COLUMN shipping_provider_reference text,
  ADD COLUMN shipping_provider_status text,
  ADD COLUMN shipping_normalized_status text CHECK (shipping_normalized_status IN
    ('pending','ready_for_collection','in_transit','out_for_delivery','delivered','exception','returned','cancelled','unknown')),
  ADD COLUMN shipping_provider_synced_at timestamptz,
  ADD COLUMN shipping_sync_error text,
  ADD COLUMN shipping_tracking_url text,
  ADD COLUMN shipping_estimated_delivery_at timestamptz,
  ADD COLUMN shipping_tracking_events jsonb;
-- Nullable events leave historical rows untouched; application treats NULL as [].
ALTER TABLE public.orders ADD CONSTRAINT orders_shipping_events_bounded
  CHECK (shipping_tracking_events IS NULL OR
    CASE WHEN jsonb_typeof(shipping_tracking_events) = 'array'
      THEN jsonb_array_length(shipping_tracking_events) <= 100 ELSE false END);
CREATE INDEX orders_active_shipping_sync_idx ON public.orders
  (shipping_provider_key, shipping_provider_synced_at NULLS FIRST, id)
  WHERE shipping_tracking_mode = 'managed' AND shipping_provider_reference IS NOT NULL
    AND status IN ('preparing', 'shipped')
    AND (shipping_normalized_status IS NULL OR shipping_normalized_status NOT IN ('delivered','returned','cancelled'));
CREATE UNIQUE INDEX orders_tenant_shipping_reference_idx ON public.orders
  (tenant_id, shipping_provider_key, shipping_provider_reference)
  WHERE shipping_provider_reference IS NOT NULL;
-- Existing orders RLS/policies/grants are unchanged. No new browser write policy.
COMMIT;

-- Rollback (only after rolling back application code; removes only V1 operational data):
-- BEGIN;
-- DROP INDEX public.orders_active_shipping_sync_idx;
-- DROP INDEX public.orders_tenant_shipping_reference_idx;
-- ALTER TABLE public.orders DROP CONSTRAINT orders_shipping_events_bounded;
-- ALTER TABLE public.orders DROP COLUMN shipping_tracking_mode, DROP COLUMN shipping_provider_key,
--   DROP COLUMN shipping_provider_reference, DROP COLUMN shipping_provider_status,
--   DROP COLUMN shipping_normalized_status, DROP COLUMN shipping_provider_synced_at,
--   DROP COLUMN shipping_sync_error, DROP COLUMN shipping_tracking_url,
--   DROP COLUMN shipping_estimated_delivery_at, DROP COLUMN shipping_tracking_events;
-- COMMIT;
