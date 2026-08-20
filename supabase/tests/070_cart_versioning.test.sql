-- Verifica della migration 070_cart_versioning.sql su un PostgreSQL vuoto.
--
-- Uso (nessun Supabase necessario, basta un postgres locale):
--
--   createdb lepefy_cart_test
--   psql -d lepefy_cart_test -v ON_ERROR_STOP=1 \
--        -f supabase/tests/070_cart_versioning.fixture.sql \
--        -f supabase/migrations/070_cart_versioning.sql \
--        -f supabase/tests/070_cart_versioning.test.sql
--
-- Ogni assert fallito interrompe lo script (raise exception).

\set ON_ERROR_STOP on

do $$
declare
  v_tenant   uuid := '11111111-1111-1111-1111-111111111111';
  v_other    uuid := '22222222-2222-2222-2222-222222222222';
  v_customer uuid := '33333333-3333-3333-3333-333333333333';
  v_prod_a   uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_prod_b   uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  v_inactive uuid := 'cccccccc-0000-0000-0000-000000000003';
  v_foreign  uuid := 'dddddddd-0000-0000-0000-000000000004';
  r          jsonb;
  v_version  bigint;
begin
  -- ─── 1. Carrello inesistente → creato a version 1, add porta a version 2 ──
  r := public.apply_cart_mutations(v_tenant, v_customer, null, jsonb_build_array(
    jsonb_build_object('id', 'm1', 'type', 'add', 'productId', v_prod_a, 'quantity', 2)
  ));
  assert r->>'status' = 'ok', 'T1 status: ' || r::text;
  assert (r->>'version')::bigint = 2, 'T1 version: ' || r::text;
  assert jsonb_array_length(r->'items') = 1, 'T1 items: ' || r::text;
  assert (r->'items'->0->>'quantity')::int = 2, 'T1 quantity: ' || r::text;
  raise notice 'T1  version 1 → 2, primo add                          OK';

  -- ─── 2. add è RELATIVO : 2 + 3 = 5 ────────────────────────────────────────
  r := public.apply_cart_mutations(v_tenant, v_customer, 2, jsonb_build_array(
    jsonb_build_object('id', 'm2', 'type', 'add', 'productId', v_prod_a, 'quantity', 3)
  ));
  assert (r->'items'->0->>'quantity')::int = 5, 'T2 quantity: ' || r::text;
  assert (r->>'version')::bigint = 3, 'T2 version: ' || r::text;
  raise notice 'T2  add relativo (2+3=5)                              OK';

  -- ─── 3. set_quantity è ASSOLUTO : non somma mai ──────────────────────────
  r := public.apply_cart_mutations(v_tenant, v_customer, 3, jsonb_build_array(
    jsonb_build_object('id', 'm3', 'type', 'set_quantity', 'productId', v_prod_a, 'quantity', 4)
  ));
  assert (r->'items'->0->>'quantity')::int = 4, 'T3 quantity: ' || r::text;
  raise notice 'T3  set_quantity assoluto (=4, non 5+4)               OK';

  -- ─── 4. IDEMPOTENZA : rinviare m3 non riapplica nulla ────────────────────
  v_version := (r->>'version')::bigint;
  r := public.apply_cart_mutations(v_tenant, v_customer, v_version, jsonb_build_array(
    jsonb_build_object('id', 'm3', 'type', 'set_quantity', 'productId', v_prod_a, 'quantity', 4)
  ));
  assert (r->'items'->0->>'quantity')::int = 4, 'T4 quantity: ' || r::text;
  assert (r->'applied_mutation_ids')::jsonb ? 'm3', 'T4 applied: ' || r::text;
  assert (r->>'version')::bigint = v_version, 'T4 version non deve cambiare: ' || r::text;
  raise notice 'T4  idempotenza per mutation id                       OK';

  -- Idempotenza su un add ritentato (il caso realmente pericoloso).
  r := public.apply_cart_mutations(v_tenant, v_customer, v_version, jsonb_build_array(
    jsonb_build_object('id', 'm5', 'type', 'add', 'productId', v_prod_a, 'quantity', 1)
  ));
  assert (r->'items'->0->>'quantity')::int = 5, 'T4b quantity: ' || r::text;
  v_version := (r->>'version')::bigint;
  r := public.apply_cart_mutations(v_tenant, v_customer, v_version, jsonb_build_array(
    jsonb_build_object('id', 'm5', 'type', 'add', 'productId', v_prod_a, 'quantity', 1)
  ));
  assert (r->'items'->0->>'quantity')::int = 5, 'T4b retry non deve incrementare: ' || r::text;
  raise notice 'T4b add ritentato non applicato due volte             OK';

  -- ─── 5. CONFLITTO : versione stale → nessuna scrittura ───────────────────
  v_version := (r->>'version')::bigint;
  r := public.apply_cart_mutations(v_tenant, v_customer, 1, jsonb_build_array(
    jsonb_build_object('id', 'm6', 'type', 'set_quantity', 'productId', v_prod_a, 'quantity', 99)
  ));
  assert r->>'status' = 'conflict', 'T5 status: ' || r::text;
  assert (r->>'version')::bigint = v_version, 'T5 version: ' || r::text;
  assert (r->'items'->0->>'quantity')::int = 5, 'T5 carrello NON deve essere sovrascritto: ' || r::text;
  raise notice 'T5  versione stale → conflict, nessuna scrittura      OK';

  -- ─── 6. Il conflict restituisce lo stato canonical per la riconciliazione ─
  assert r ? 'items' and r ? 'version', 'T6 payload conflict: ' || r::text;
  raise notice 'T6  conflict include lo stato canonical               OK';

  -- ─── 7. CONCORRENZA : due device, due add, entrambi preservati ───────────
  -- Device A e device B leggono la stessa versione e aggiungono prodotti
  -- diversi. B riceve conflict, riparte dalla versione restituita e ritenta:
  -- il risultato contiene ENTRAMBI i prodotti.
  v_version := (r->>'version')::bigint;
  r := public.apply_cart_mutations(v_tenant, v_customer, v_version, jsonb_build_array(
    jsonb_build_object('id', 'devA', 'type', 'add', 'productId', v_prod_b, 'quantity', 1)
  ));
  assert r->>'status' = 'ok', 'T7 device A: ' || r::text;

  r := public.apply_cart_mutations(v_tenant, v_customer, v_version, jsonb_build_array(
    jsonb_build_object('id', 'devB', 'type', 'add', 'productId', v_prod_a, 'quantity', 1)
  ));
  assert r->>'status' = 'conflict', 'T7 device B deve ricevere conflict: ' || r::text;

  r := public.apply_cart_mutations(v_tenant, v_customer, (r->>'version')::bigint, jsonb_build_array(
    jsonb_build_object('id', 'devB', 'type', 'add', 'productId', v_prod_a, 'quantity', 1)
  ));
  assert r->>'status' = 'ok', 'T7 device B retry: ' || r::text;
  assert jsonb_array_length(r->'items') = 2, 'T7 entrambi i prodotti: ' || r::text;
  assert (select (e->>'quantity')::int from jsonb_array_elements(r->'items') e
           where e->>'product_id' = v_prod_a::text) = 6, 'T7 quantità A: ' || r::text;
  assert (select (e->>'quantity')::int from jsonb_array_elements(r->'items') e
           where e->>'product_id' = v_prod_b::text) = 1, 'T7 quantità B: ' || r::text;
  raise notice 'T7  due device concorrenti, entrambe le modifiche     OK';

  -- ─── 8. remove ───────────────────────────────────────────────────────────
  v_version := (r->>'version')::bigint;
  r := public.apply_cart_mutations(v_tenant, v_customer, v_version, jsonb_build_array(
    jsonb_build_object('id', 'm7', 'type', 'remove', 'productId', v_prod_b)
  ));
  assert jsonb_array_length(r->'items') = 1, 'T8 items: ' || r::text;
  assert r->'items'->0->>'product_id' = v_prod_a::text, 'T8 prodotto restante: ' || r::text;
  raise notice 'T8  remove                                            OK';

  -- ─── 9. Normalizzazione sullo stock (server authoritative) ───────────────
  v_version := (r->>'version')::bigint;
  r := public.apply_cart_mutations(v_tenant, v_customer, v_version, jsonb_build_array(
    jsonb_build_object('id', 'm8', 'type', 'set_quantity', 'productId', v_prod_a, 'quantity', 500)
  ));
  assert (r->'items'->0->>'quantity')::int = 10, 'T9 clamp allo stock (10): ' || r::text;
  raise notice 'T9  quantità normalizzata sullo stock                 OK';

  -- ─── 10. Prodotto inattivo → segnalato, mai applicato in silenzio ────────
  v_version := (r->>'version')::bigint;
  r := public.apply_cart_mutations(v_tenant, v_customer, v_version, jsonb_build_array(
    jsonb_build_object('id', 'm9', 'type', 'add', 'productId', v_inactive, 'quantity', 1)
  ));
  assert (r->'unavailable_product_ids') ? v_inactive::text, 'T10 unavailable: ' || r::text;
  assert jsonb_array_length(r->'items') = 1, 'T10 items invariati: ' || r::text;
  raise notice 'T10 prodotto inattivo segnalato al client             OK';

  -- ─── 11. TENANT ISOLATION : prodotto di un altro tenant rifiutato ────────
  r := public.apply_cart_mutations(v_tenant, v_customer, null, jsonb_build_array(
    jsonb_build_object('id', 'm10', 'type', 'add', 'productId', v_foreign, 'quantity', 1)
  ));
  assert (r->'unavailable_product_ids') ? v_foreign::text, 'T11 unavailable: ' || r::text;
  assert not exists (
    select 1 from jsonb_array_elements(r->'items') e where e->>'product_id' = v_foreign::text
  ), 'T11 prodotto di un altro tenant nel carrello: ' || r::text;
  raise notice 'T11 prodotto di un altro tenant rifiutato             OK';

  -- ─── 12. clear ───────────────────────────────────────────────────────────
  r := public.apply_cart_mutations(v_tenant, v_customer, null, jsonb_build_array(
    jsonb_build_object('id', 'm11', 'type', 'clear')
  ));
  assert jsonb_array_length(r->'items') = 0, 'T12 items: ' || r::text;
  raise notice 'T12 clear                                             OK';

  -- ─── 13. replace (percorso legacy PUT) ───────────────────────────────────
  r := public.apply_cart_mutations(v_tenant, v_customer, null, jsonb_build_array(
    jsonb_build_object('id', 'm12', 'type', 'replace', 'items', jsonb_build_array(
      jsonb_build_object('productId', v_prod_a, 'quantity', 2),
      jsonb_build_object('productId', v_foreign, 'quantity', 9)
    ))
  ));
  assert jsonb_array_length(r->'items') = 1, 'T13 solo i prodotti del tenant: ' || r::text;
  assert (r->'items'->0->>'quantity')::int = 2, 'T13 quantity: ' || r::text;
  raise notice 'T13 replace legacy valida i prodotti                  OK';

  -- ─── 14. Carrello esistente PRIMA della migration (compatibilità) ────────
  -- La riga di 068 (senza version) è stata creata nella fixture: il DEFAULT le
  -- ha dato version = 1 e continua a funzionare senza alcuna riscrittura.
  select version into v_version from public.carts
   where tenant_id = v_other and customer_id = v_customer;
  assert v_version = 1, 'T14 version di default sui carrelli esistenti: ' || v_version;
  r := public.apply_cart_mutations(v_other, v_customer, 1, jsonb_build_array(
    jsonb_build_object('id', 'm13', 'type', 'add', 'productId', v_foreign, 'quantity', 1)
  ));
  assert r->>'status' = 'ok', 'T14 status: ' || r::text;
  assert (r->>'version')::bigint = 2, 'T14 version: ' || r::text;
  assert (select (e->>'quantity')::int from jsonb_array_elements(r->'items') e
           where e->>'product_id' = v_foreign::text) = 4, 'T14 items preesistenti conservati: ' || r::text;
  raise notice 'T14 carrelli preesistenti intatti, version 1 → 2      OK';

  raise notice '── TUTTI I TEST SQL PASSATI ─────────────────────────────────';
end;
$$;
