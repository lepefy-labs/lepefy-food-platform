-- Disposable CI fixture only; NEVER run against application databases.
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.tenants (id uuid PRIMARY KEY, name text, active boolean default true);
CREATE TABLE public.customers (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id));
CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  customer_id uuid,
  email text NOT NULL,
  full_name text,
  status text NOT NULL,
  payment_status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.admin_users (id uuid PRIMARY KEY);
CREATE TABLE public.admin_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL);
CREATE TABLE public.admin_permissions (
  key text PRIMARY KEY, module text NOT NULL, label text NOT NULL, description text,
  risk_level text NOT NULL DEFAULT 'standard', position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.admin_role_permissions (
  role_id uuid NOT NULL REFERENCES public.admin_roles(id),
  permission_key text NOT NULL REFERENCES public.admin_permissions(key),
  PRIMARY KEY (role_id, permission_key)
);
CREATE TABLE public.platform_features (
  key text PRIMARY KEY, name text NOT NULL, description text, category text NOT NULL,
  active boolean NOT NULL DEFAULT true, billable boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.platform_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL);
CREATE TABLE public.platform_plan_features (
  plan_id uuid NOT NULL REFERENCES public.platform_plans(id), feature_key text NOT NULL REFERENCES public.platform_features(key),
  label text, position integer NOT NULL DEFAULT 0, PRIMARY KEY (plan_id, feature_key)
);
CREATE TABLE public.customer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  event_type text NOT NULL CHECK (event_type IN (
    'customer_created','account_linked','order_completed','product_purchased','category_purchased',
    'loyalty_points_earned','loyalty_points_redeemed','in_store_purchase','event_reserved',
    'event_attended','marketing_consent_granted','marketing_consent_revoked'
  )),
  source text NOT NULL, entity_type text, entity_id uuid, event_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_key)
);

INSERT INTO public.tenants(id,name) VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Tenant A'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Tenant B');
INSERT INTO public.customers(id,tenant_id) VALUES
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
 ('22222222-2222-2222-2222-222222222222','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO public.orders(id,tenant_id,customer_id,email,full_name,status,payment_status,updated_at) VALUES
 ('10000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','a@example.test','Alice Example','delivered','paid',now()),
 ('10000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','a@example.test','Alice Example','delivered','pending',now()),
 ('20000000-0000-0000-0000-000000000001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','b@example.test','Bob Example','delivered','paid',now());
INSERT INTO public.admin_users(id) VALUES ('99999999-9999-9999-9999-999999999999');
INSERT INTO public.admin_roles(code) VALUES ('platform_owner'),('tenant_admin');
INSERT INTO public.platform_plans(code) VALUES ('food-platform');
