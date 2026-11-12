-- 182: in-store channel (/card payments) — paid only, tenant isolation, buckets, orders untouched.
do $$
declare
  v_a uuid := '11111111-1111-4111-8111-111111111111';
  v jsonb;
begin
  v := public.admin_sales_statistics(v_a, '2026-09-30T22:00:00Z', '2026-10-31T23:00:00Z', 'day', 'Europe/Paris');

  if (v->'in_store'->>'payments')::int <> 3 then raise exception 'payments: %', v->'in_store'; end if;
  if (v->'in_store'->>'revenue')::numeric <> 50 then raise exception 'revenue: %', v->'in_store'; end if;

  -- Order keys unchanged by the new channel.
  if (v->'totals'->>'orders')::int <> 3 or (v->'totals'->>'revenue')::numeric <> 90 then raise exception 'orders changed: %', v->'totals'; end if;

  -- Day buckets in Paris time: 6 October (30) and 10 October (2 payments, 20).
  if jsonb_array_length(v->'in_store'->'series') <> 2
     or v->'in_store'->'series'->1->>'bucket' <> '2026-10-10'
     or (v->'in_store'->'series'->1->>'payments')::int <> 2
     or (v->'in_store'->'series'->1->>'revenue')::numeric <> 20 then
    raise exception 'series: %', v->'in_store'->'series';
  end if;

  -- Heatmap: Saturday (isodow 6) slot 2 (08-12) = 2, Tuesday slot 4 (16-20) = 1.
  if not exists (select 1 from jsonb_array_elements(v->'in_store'->'heatmap') e where (e->>'weekday')::int = 6 and (e->>'slot')::int = 2 and (e->>'payments')::int = 2) then
    raise exception 'heatmap saturday: %', v->'in_store'->'heatmap';
  end if;
  if not exists (select 1 from jsonb_array_elements(v->'in_store'->'heatmap') e where (e->>'weekday')::int = 2 and (e->>'slot')::int = 4 and (e->>'payments')::int = 1) then
    raise exception 'heatmap tuesday: %', v->'in_store'->'heatmap';
  end if;

  -- Empty period: zeros and empty arrays, never null.
  v := public.admin_sales_statistics(v_a, '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z', 'week', 'Europe/Paris');
  if (v->'in_store'->>'payments')::int <> 0 or (v->'in_store'->>'revenue')::numeric <> 0
     or v->'in_store'->'series' <> '[]'::jsonb or v->'in_store'->'heatmap' <> '[]'::jsonb then
    raise exception 'empty in_store: %', v->'in_store';
  end if;

  -- Privileges unchanged: service role only.
  if has_function_privilege('anon', 'public.admin_sales_statistics(uuid, timestamptz, timestamptz, text, text)', 'execute') then raise exception 'anon can execute'; end if;
  if not has_function_privilege('service_role', 'public.admin_sales_statistics(uuid, timestamptz, timestamptz, text, text)', 'execute') then raise exception 'service role cannot execute'; end if;
end $$;
