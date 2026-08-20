-- ─── MIGRATION 070: CART VERSIONING + MUTATION-BASED SYNC ──────────────────
-- Estende 068_carts.sql per rendere il carrello cross-device production-ready.
--
-- Problema risolto: prima di questa migration il client faceva PUT dell'intero
-- carrello senza alcun controllo di concorrenza. Due device che modificavano il
-- carrello nello stesso momento producevano last-write-wins, con perdita
-- silenziosa della modifica arrivata per prima.
--
-- Soluzione: optimistic concurrency control (colonna `version`) + applicazione
-- di *mutation* semanticamente distinte (add relativo vs set_quantity assoluto)
-- dentro un'unica funzione transazionale, invece della sostituzione dello stato
-- completo.
--
-- Retrocompatibile: nessuna colonna rimossa, nessun dato riscritto. I carrelli
-- esistenti partono da version = 1 grazie al DEFAULT, e continuano a funzionare
-- con il vecchio PUT full-state (che ora passa comunque da questa funzione con
-- una mutation di tipo 'replace', quindi incrementa la versione correttamente).

alter table public.carts
  add column if not exists version bigint not null default 1;

comment on column public.carts.version is
  'Optimistic concurrency control. Incrementata di 1 ad ogni applicazione di '
  'mutation riuscita. Il client invia expectedVersion: se non coincide con '
  'questo valore il server risponde conflict e NON sovrascrive nulla.';

-- Ring buffer degli ultimi mutation id applicati — serve all''idempotenza:
-- una richiesta ritentata dopo un timeout di rete (dove la scrittura era in
-- realtà andata a buon fine) non deve applicare due volte lo stesso "+1".
alter table public.carts
  add column if not exists applied_mutation_ids jsonb not null default '[]'::jsonb;

comment on column public.carts.applied_mutation_ids is
  'Array degli ultimi 100 mutation id applicati (ring buffer). Una mutation '
  'il cui id è già presente viene ignorata e riportata comunque come applicata '
  'al client: garantisce l''idempotenza dei retry dopo timeout/errori di rete.';


-- ─── APPLICAZIONE ATOMICA DELLE MUTATION ────────────────────────────────────
-- Un''unica funzione PL/pgSQL = un''unica transazione. La riga viene bloccata
-- con SELECT ... FOR UPDATE prima di leggere la versione: nessuna finestra tra
-- il controllo della versione e la scrittura, quindi nessuna race condition tra
-- due device che sincronizzano nello stesso istante (il secondo attende il
-- commit del primo e vede la versione già incrementata → conflict, mai
-- sovrascrittura). Stesso pattern transazionale già usato da
-- decrement_stock_for_order (029_atomic_stock_decrement.sql).
--
-- p_expected_version = null → applicazione forzata senza controllo di versione,
-- riservata al vecchio endpoint PUT full-state mantenuto per retrocompatibilità.
--
-- Ritorna:
--   { status: 'ok'|'conflict',
--     version: bigint,
--     items: [{product_id, quantity}],
--     applied_mutation_ids: [uuid...],
--     unavailable_product_ids: [uuid...] }
create or replace function public.apply_cart_mutations(
  p_tenant_id        uuid,
  p_customer_id      uuid,
  p_expected_version bigint,
  p_mutations        jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_version     bigint;
  v_items       jsonb;
  v_applied     jsonb;
  v_mutation    jsonb;
  v_mutation_id text;
  v_type        text;
  v_product_id  uuid;
  v_qty         int;
  v_stock       int;
  v_current     int;
  v_item        jsonb;
  v_new_applied jsonb := '[]'::jsonb;
  v_unavailable jsonb := '[]'::jsonb;
  v_changed     boolean := false;
  v_rows        int;
begin
  -- Garantisce l'esistenza della riga: evita di dover distinguere il caso
  -- "primo carrello" in ogni ramo sottostante.
  insert into public.carts (tenant_id, customer_id, items)
  values (p_tenant_id, p_customer_id, '[]'::jsonb)
  on conflict (tenant_id, customer_id) do nothing;

  select c.version, c.items, c.applied_mutation_ids
    into v_version, v_items, v_applied
    from public.carts c
   where c.tenant_id = p_tenant_id
     and c.customer_id = p_customer_id
     for update;

  -- Optimistic concurrency: versione non coincidente → nessuna scrittura, si
  -- restituisce lo stato canonical così com'è. È il client a riconciliare le
  -- proprie mutation pending su questo stato e a ritentare.
  if p_expected_version is not null and p_expected_version <> v_version then
    return jsonb_build_object(
      'status',                  'conflict',
      'version',                 v_version,
      'items',                   v_items,
      'applied_mutation_ids',    '[]'::jsonb,
      'unavailable_product_ids', '[]'::jsonb
    );
  end if;

  for v_mutation in
    select value from jsonb_array_elements(coalesce(p_mutations, '[]'::jsonb))
  loop
    v_mutation_id := v_mutation->>'id';
    v_type        := v_mutation->>'type';

    -- Idempotenza: già applicata in una richiesta precedente (retry dopo
    -- timeout). La si riporta come applicata senza rieseguirla.
    if v_mutation_id is not null and v_applied ? v_mutation_id then
      v_new_applied := v_new_applied || to_jsonb(v_mutation_id);
      continue;
    end if;

    if v_type = 'clear' then
      v_items   := '[]'::jsonb;
      v_changed := true;

    elsif v_type = 'replace' then
      -- Percorso legacy (PUT full-state). Ogni riga è comunque validata e
      -- normalizzata sullo stock come le altre mutation.
      v_items := '[]'::jsonb;
      for v_item in
        select value from jsonb_array_elements(coalesce(v_mutation->'items', '[]'::jsonb))
      loop
        v_product_id := nullif(v_item->>'productId', '')::uuid;
        v_qty        := coalesce((v_item->>'quantity')::int, 0);
        if v_product_id is null then
          continue;
        end if;

        select p.stock into v_stock
          from public.products p
         where p.id = v_product_id
           and p.tenant_id = p_tenant_id
           and p.active = true;

        if v_stock is null then
          if not (v_unavailable ? v_product_id::text) then
            v_unavailable := v_unavailable || to_jsonb(v_product_id::text);
          end if;
          continue;
        end if;

        v_qty := least(greatest(v_qty, 0), v_stock);
        if v_qty > 0 then
          v_items := v_items || jsonb_build_array(
            jsonb_build_object('product_id', v_product_id, 'quantity', v_qty)
          );
        end if;
      end loop;
      v_changed := true;

    elsif v_type in ('add', 'set_quantity', 'remove') then
      v_product_id := nullif(v_mutation->>'productId', '')::uuid;
      if v_product_id is null then
        continue;
      end if;

      -- Validazione prodotto: esiste, è attivo, appartiene a QUESTO tenant.
      -- Il tenant non arriva mai dal client (cf. route handler): deriva dalla
      -- sessione, quindi un customer non può toccare i prodotti di un altro
      -- tenant nemmeno inviando un product_id valido altrove.
      select p.stock into v_stock
        from public.products p
       where p.id = v_product_id
         and p.tenant_id = p_tenant_id
         and p.active = true;

      if v_stock is null then
        -- Prodotto non più disponibile: la mutation viene marcata come
        -- applicata (ritentarla non cambierebbe nulla) ma il product_id è
        -- riportato al client, che può informare l'utente. Mai una rimozione
        -- silenziosa e mai un retry infinito.
        if not (v_unavailable ? v_product_id::text) then
          v_unavailable := v_unavailable || to_jsonb(v_product_id::text);
        end if;
        if v_mutation_id is not null then
          v_new_applied := v_new_applied || to_jsonb(v_mutation_id);
        end if;
        continue;
      end if;

      select coalesce((
        select (e->>'quantity')::int
          from jsonb_array_elements(v_items) e
         where e->>'product_id' = v_product_id::text
         limit 1
      ), 0) into v_current;

      if v_type = 'add' then
        -- Relativo: è questo che rende commutativi due add concorrenti
        -- provenienti da device diversi (nessuno dei due sovrascrive l'altro).
        v_qty := v_current + coalesce((v_mutation->>'quantity')::int, 0);
      elsif v_type = 'set_quantity' then
        -- Assoluto: intento esplicito dell'utente, non si somma mai.
        v_qty := coalesce((v_mutation->>'quantity')::int, 0);
      else
        v_qty := 0;
      end if;

      -- Il server resta authoritative sullo stock: normalizza senza mai
      -- riservarlo (la validazione bloccante resta al checkout, invariata).
      v_qty := least(greatest(v_qty, 0), v_stock);

      if v_current > 0 then
        -- Aggiornamento in place: preserva l'ordine delle righe del carrello.
        select coalesce(jsonb_agg(
                 case when t.e->>'product_id' = v_product_id::text
                      then jsonb_build_object('product_id', v_product_id, 'quantity', v_qty)
                      else t.e end
                 order by t.ord
               ), '[]'::jsonb)
          into v_items
          from jsonb_array_elements(v_items) with ordinality as t(e, ord)
         where not (t.e->>'product_id' = v_product_id::text and v_qty = 0);
      elsif v_qty > 0 then
        v_items := v_items || jsonb_build_array(
          jsonb_build_object('product_id', v_product_id, 'quantity', v_qty)
        );
      end if;
      v_changed := true;

    else
      -- Tipo sconosciuto: ignorato, mai un errore bloccante per l'intero batch.
      continue;
    end if;

    if v_mutation_id is not null then
      v_new_applied := v_new_applied || to_jsonb(v_mutation_id);
    end if;
  end loop;

  -- Nessuna mutation applicabile → nessuna scrittura, nessun incremento di
  -- versione (evita di invalidare inutilmente la versione degli altri device).
  if not v_changed then
    return jsonb_build_object(
      'status',                  'ok',
      'version',                 v_version,
      'items',                   v_items,
      'applied_mutation_ids',    v_new_applied,
      'unavailable_product_ids', v_unavailable
    );
  end if;

  -- Ring buffer: si conservano solo gli ultimi 100 id, altrimenti la colonna
  -- crescerebbe senza limite per un cliente molto attivo.
  select coalesce(jsonb_agg(t.value order by t.ord), '[]'::jsonb)
    into v_applied
    from (
      select value, ord
        from jsonb_array_elements(v_applied || v_new_applied) with ordinality as x(value, ord)
       order by ord desc
       limit 100
    ) t;

  update public.carts c
     set items                = v_items,
         applied_mutation_ids = v_applied,
         version              = c.version + 1,
         updated_at           = now()
   where c.tenant_id = p_tenant_id
     and c.customer_id = p_customer_id
     and c.version = v_version;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    -- Irraggiungibile finché il FOR UPDATE sopra tiene il lock — guardia
    -- esplicita perché un fallimento silenzioso qui sarebbe una perdita dati.
    raise exception 'cart_concurrent_update';
  end if;

  return jsonb_build_object(
    'status',                  'ok',
    'version',                 v_version + 1,
    'items',                   v_items,
    'applied_mutation_ids',    v_new_applied,
    'unavailable_product_ids', v_unavailable
  );
end;
$$;

comment on function public.apply_cart_mutations(uuid, uuid, bigint, jsonb) is
  'Applica atomicamente una lista di mutation al carrello di un cliente con '
  'optimistic concurrency control. Mutation supportate: add (relativo), '
  'set_quantity (assoluto), remove, clear, replace (legacy full-state). '
  'Ritorna status=conflict senza scrivere nulla se p_expected_version non '
  'coincide con la versione corrente. Idempotente per mutation id.';

grant execute on function public.apply_cart_mutations(uuid, uuid, bigint, jsonb) to service_role;
