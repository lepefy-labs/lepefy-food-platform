-- Disposable CI PostgreSQL fixture only; NEVER run against application databases.
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon;
CREATE TABLE public.orders (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, status text NOT NULL,
  tracking_code text, tracking_carrier text, shipped_at timestamptz,
  shipping_details jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY orders_tenant_read ON public.orders FOR SELECT TO anon
  USING (tenant_id = current_setting('test.tenant_id', true)::uuid);
GRANT SELECT ON public.orders TO anon;
INSERT INTO public.orders(id, tenant_id, status, shipping_details) VALUES
  ('10000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','delivered','{"quote":100}'),
  ('10000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','preparing','{"quote":200}');
CREATE TABLE public.shipping_before AS SELECT * FROM public.orders;
