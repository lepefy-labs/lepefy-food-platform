-- 177_address_company_name.sql
-- Entreprise destinataire dans la rubrique d'adresses du client (/compte).
--
-- Additive et réversible : une colonne nullable, aucune donnée existante modifiée.
-- Les commandes portent déjà l'entreprise dans orders.shipping_address (JSON,
-- clé company_name) : aucune migration pour elles.
--
-- Le code est compatible avec les deux états : tant que cette migration n'est
-- pas appliquée, les lectures/écritures retombent sur l'ancien schéma (l'entreprise
-- n'est alors simplement pas mémorisée dans la rubrique).

alter table public.addresses
  add column if not exists company_name text;

alter table public.addresses
  drop constraint if exists addresses_company_name_length;
alter table public.addresses
  add constraint addresses_company_name_length
  check (company_name is null or char_length(company_name) <= 80);

comment on column public.addresses.company_name is
  'Entreprise destinataire (facultatif, <= 80 caractères). Distincte de full_name, qui reste le destinataire; jamais stockée dans line2.';

-- upsert_default_address : nouveau paramètre facultatif p_company_name. L'ancienne
-- signature (8 arguments) est remplacée, sinon un appel nommé à 8 arguments
-- serait ambigu entre les deux surcharges.
drop function if exists public.upsert_default_address(uuid, uuid, text, text, text, text, text, text);

create or replace function public.upsert_default_address(
  p_customer_id  uuid,
  p_tenant_id    uuid,
  p_full_name    text,
  p_line1        text,
  p_line2        text,
  p_city         text,
  p_postal_code  text,
  p_country      text,
  p_company_name text default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_company text := nullif(btrim(coalesce(p_company_name, '')), '');
begin
  -- Même adresse (entreprise comprise) déjà enregistrée → ré-promue, jamais dupliquée.
  select id into v_id
  from public.addresses
  where customer_id = p_customer_id
    and tenant_id   = p_tenant_id
    and lower(btrim(line1))                  = lower(btrim(p_line1))
    and lower(btrim(coalesce(line2, '')))    = lower(btrim(coalesce(p_line2, '')))
    and lower(btrim(city))                   = lower(btrim(p_city))
    and lower(btrim(postal_code))            = lower(btrim(p_postal_code))
    and lower(btrim(country))                = lower(btrim(p_country))
    and lower(btrim(coalesce(company_name, ''))) = lower(coalesce(v_company, ''))
  limit 1;

  update public.addresses
  set is_default = false
  where customer_id = p_customer_id
    and tenant_id   = p_tenant_id
    and is_default  = true
    and (v_id is null or id <> v_id);

  if v_id is not null then
    update public.addresses
    set is_default = true,
        full_name  = coalesce(nullif(btrim(p_full_name), ''), full_name)
    where id = v_id;
    return v_id;
  end if;

  insert into public.addresses (
    customer_id, tenant_id, full_name, company_name, line1, line2,
    city, postal_code, country, is_default
  ) values (
    p_customer_id, p_tenant_id, coalesce(nullif(btrim(p_full_name), ''), ''), v_company,
    p_line1, nullif(btrim(coalesce(p_line2, '')), ''),
    p_city, p_postal_code, coalesce(nullif(btrim(p_country), ''), 'IT'), true
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.upsert_default_address(
  uuid, uuid, text, text, text, text, text, text, text
) to service_role;

-- Retour arrière (manuel) :
--   alter table public.addresses drop constraint addresses_company_name_length;
--   alter table public.addresses drop column company_name;
--   puis recréer upsert_default_address depuis 044_customer_default_address.sql.
