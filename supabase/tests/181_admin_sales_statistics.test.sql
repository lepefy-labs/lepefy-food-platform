-- 181: sales statistics — counted-order rule, tenant isolation, time zone buckets, privileges.
do $$
declare
  v_a uuid := '11111111-1111-4111-8111-111111111111';
  v jsonb;
begin
  -- Period: October 2026 in Paris time ([2026-09-30 22:00Z, 2026-10-31 23:00Z)).
  v := public.admin_sales_statistics(v_a, '2026-09-30T22:00:00Z', '2026-10-31T23:00:00Z', 'day', 'Europe/Paris');

  if (v->'totals'->>'orders')::int <> 3 then raise exception 'orders: %', v->'totals'; end if;
  if (v->'totals'->>'revenue')::numeric <> 90 then raise exception 'revenue: %', v->'totals'; end if;
  if (v->'totals'->>'customers')::int <> 3 then raise exception 'customers: %', v->'totals'; end if;
  if (v->'totals'->>'new_customers')::int <> 2 then raise exception 'new customers: %', v->'totals'; end if;
  if (v->'totals'->>'returning_customers')::int <> 1 then raise exception 'returning: %', v->'totals'; end if;
  if (v->'totals'->>'units')::int <> 8 then raise exception 'units: %', v->'totals'; end if;

  -- 2026-10-05T22:30Z is 6 October 00:30 in Paris: one day bucket with the three orders.
  if jsonb_array_length(v->'series') <> 1 or v->'series'->0->>'bucket' <> '2026-10-06' or (v->'series'->0->>'orders')::int <> 3 then
    raise exception 'series: %', v->'series';
  end if;

  -- Categories: unknown product → null category; cancelled lines never counted.
  if v->'categories'->0->>'name' <> 'Farines' or (v->'categories'->0->>'revenue')::numeric <> 60 then raise exception 'categories: %', v->'categories'; end if;
  if not exists (select 1 from jsonb_array_elements(v->'categories') e where e->>'name' is null and (e->>'revenue')::numeric = 10) then
    raise exception 'uncategorised line missing: %', v->'categories';
  end if;

  -- Products: current catalogue name wins over the line snapshot.
  if v->'products'->0->>'name' <> 'Farine de manioc' or (v->'products'->0->>'units')::int <> 6 then raise exception 'products: %', v->'products'; end if;

  -- Countries are upper-cased and only for deliveries.
  if (select count(*) from jsonb_array_elements(v->'countries')) <> 2 then raise exception 'countries: %', v->'countries'; end if;
  if v->'countries'->0->>'key' <> 'IT' then raise exception 'country order: %', v->'countries'; end if;

  -- Heatmap: Tuesday 6 October (isodow 2), slots 00-04, 08-12 (10:00 Paris), 12-16 (15:00 Paris).
  if (select count(*) from jsonb_array_elements(v->'heatmap') e where (e->>'weekday')::int = 2) <> 3 then raise exception 'heatmap: %', v->'heatmap'; end if;

  -- Weekly / monthly buckets.
  v := public.admin_sales_statistics(v_a, '2026-09-30T22:00:00Z', '2026-10-31T23:00:00Z', 'month', 'Europe/Paris');
  if v->'series'->0->>'bucket' <> '2026-10-01' then raise exception 'month bucket: %', v->'series'; end if;

  -- Empty period: zeros and empty arrays, never null.
  v := public.admin_sales_statistics(v_a, '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z', 'week', 'Europe/Paris');
  if (v->'totals'->>'orders')::int <> 0 or (v->'totals'->>'revenue')::numeric <> 0 or v->'series' <> '[]'::jsonb or v->'products' <> '[]'::jsonb then
    raise exception 'empty period: %', v;
  end if;

  -- Invalid input is refused.
  begin
    perform public.admin_sales_statistics(v_a, '2026-10-02T00:00:00Z', '2026-10-01T00:00:00Z', 'day', 'Europe/Paris');
    raise exception 'reversed range accepted';
  exception when raise_exception then
    if sqlerrm <> 'invalid_statistics_range' then raise; end if;
  end;
  begin
    perform public.admin_sales_statistics(v_a, '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', 'hour', 'Europe/Paris');
    raise exception 'unknown bucket accepted';
  exception when raise_exception then
    if sqlerrm <> 'invalid_statistics_range' then raise; end if;
  end;

  -- Privileges: service role only.
  if has_function_privilege('anon', 'public.admin_sales_statistics(uuid, timestamptz, timestamptz, text, text)', 'execute') then raise exception 'anon can execute'; end if;
  if has_function_privilege('authenticated', 'public.admin_sales_statistics(uuid, timestamptz, timestamptz, text, text)', 'execute') then raise exception 'authenticated can execute'; end if;
  if not has_function_privilege('service_role', 'public.admin_sales_statistics(uuid, timestamptz, timestamptz, text, text)', 'execute') then raise exception 'service role cannot execute'; end if;
end $$;
