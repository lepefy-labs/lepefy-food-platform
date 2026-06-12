-- ─── MIGRATION 008: PICKING LIST FIELDS ──────────────────────────────────────
-- Aggiunge campi logistici ai prodotti per ottimizzare il picking in magazzino.
-- warehouse_location: posizione fisica (es. "A3", "B12", "FRIGO-1", "SURGELATI")
-- name_alt: nome alternativo/originale in lingua locale per evitare scambi di referenze

alter table products
  add column if not exists warehouse_location text;

alter table products
  add column if not exists name_alt text;

comment on column products.warehouse_location is
  'Ubicazione fisica in magazzino (es. "A3", "FRIGO-1"). '
  'Usata per ordinare la picking list e ottimizzare il percorso del magazziniere.';

comment on column products.name_alt is
  'Nome alternativo/originale del prodotto (lingua locale, variante commerciale). '
  'Mostrato nella picking list per evitare scambi tra referenze simili.';

-- GRANTs obbligatori (pattern Lepefy: RLS non è sufficiente)
GRANT SELECT, UPDATE ON public.products TO anon, authenticated, service_role;
