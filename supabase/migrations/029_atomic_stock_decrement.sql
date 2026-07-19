-- 029_atomic_stock_decrement.sql
-- Decremento atomico dello stock alla conferma ordine (checkout in-store
-- sincrono, o webhook Stripe payment_intent.succeeded). Prima di questa
-- migration NESSUN trigger/constraint/funzione decrementava o verificava
-- lo stock alla creazione ordine — rilevato durante l'audit performance
-- (Prompt 4), corretto qui (Prompt "Ricontrollo e decremento stock").

create or replace function public.decrement_stock_for_order(items jsonb)
returns void
language plpgsql
as $$
declare
  item     record;
  affected int;
begin
  for item in
    select * from jsonb_to_recordset(items) as x(product_id uuid, quantity int)
  loop
    update public.products
    set stock = stock - item.quantity
    where id = item.product_id
      and stock >= item.quantity;

    get diagnostics affected = row_count;

    if affected = 0 then
      -- Nessuna riga aggiornata: stock insufficiente per questo prodotto
      -- nell'istante esatto della UPDATE (o product_id inesistente).
      -- L'exception annulla TUTTI i decrementi già eseguiti in questo
      -- stesso loop — la funzione PL/pgSQL è transazionale di per sé, mai
      -- un decremento parziale sopravvive a un fallimento.
      raise exception 'insufficient_stock:%', item.product_id;
    end if;
  end loop;
end;
$$;

comment on function public.decrement_stock_for_order(jsonb) is
  'Decrementa lo stock di più prodotti in un colpo, atomicamente (tutto o '
  'niente). Parametro items = [{"product_id": "...", "quantity": N}, ...]. '
  'Solleva "insufficient_stock:<product_id>" se un solo prodotto non ha '
  'stock sufficiente al momento esatto della chiamata: l''intera funzione '
  'viene annullata, nessun decremento parziale viene mai conservato. '
  'Chiamata da /api/checkout (ordini in-store, sincrono) e da '
  '/api/webhooks/stripe (payment_intent.succeeded, ordini Stripe).';

grant execute on function public.decrement_stock_for_order(jsonb) to service_role;

-- ─── Stato ordine "conflitto stock post-pagamento" ────────────────────────────
-- Cas rare : le paiement Stripe a déjà été capturé (payment_intent.succeeded)
-- au moment où le décrément atomique échoue (race condition entre deux
-- clients sur le dernier exemplaire). On ne peut plus simplement rejeter la
-- commande — il faut la marquer distinctement pour déclencher remboursement +
-- notification admin (cf. code applicatif), sans réutiliser 'cancelled' qui
-- ne raconte pas la même histoire (annulation normale vs conflit à traiter).
--
-- IMPORTANT : 'ready_for_pickup' est inclus ci-dessous bien qu'absent de la
-- contrainte définie dans 001_initial_schema.sql — le code applicatif
-- l'utilise activement et sans erreur en production (bulk-status route,
-- filtres admin, StatusBadge), ce qui veut dire que la contrainte réelle en
-- base a déjà été étendue manuellement (Supabase SQL editor / dashboard) sans
-- migration correspondante dans ce repo. Un simple drop+recreate sans cette
-- valeur aurait supprimé silencieusement ce statut existant et cassé ce
-- workflow — vérifié dans le code avant d'écrire cette migration, pas
-- supposé.
alter table orders
  drop constraint if exists orders_status_check;

alter table orders
  add constraint orders_status_check
  check (status in ('new', 'preparing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled', 'stock_conflict'));

comment on constraint orders_status_check on orders is
  'stock_conflict : paiement Stripe capturé mais décrément de stock échoué '
  'après coup (race condition) — remboursement Stripe + notification admin '
  'déclenchés automatiquement, commande non préparée.';
