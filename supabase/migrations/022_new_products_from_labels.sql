-- ─── NUOVI PRODOTTI — emersi dalle schede etichetta, non presenti nel catalogo v2 ─
-- Inseriti con price = 0.00, active = false, stock = 0: NON compariranno nello
-- storefront finché Robertin non imposta prezzo/stock reali e attiva il prodotto
-- dall'admin (stessa convenzione già usata per gli 8 prodotti senza prezzo nel
-- catalogo principale).

-- 1. Garri Tapioca — Granula di manioca secca (Garri / Tapioca)
--    Prodotto reale non presente nel catalogo ChloeFood_Template_Catalogue_v2.
--    Categoria assunta: Farines (stesso segmento di Foufou/Chikwang) — verificare.
insert into products (
  tenant_id, category_id, name, slug, price, weight_grams, stock,
  active, featured, storage_type,
  ingredients_text, conservation_instructions, country_of_origin,
  packaging_material, net_quantity_display, nutrition_basis, nutrition,
  durability_type, importer_id
)
values (
  (select id from tenants where slug = 'chloefood'),
  (select id from categories where slug = 'farines' and tenant_id = (select id from tenants where slug = 'chloefood')),
  'Garri / Tapioca', 'garri-tapioca', 0.00, 1000, 0, false, false, 'dry',
  '100% manioca',
  'Conservare in luogo fresco e asciutto',
  'Camerun',
  'plastica',
  '1 kg',
  '100g',
  '{"kj": 1506.24, "kcal": 360, "carbs_g": 85, "protein_g": 1, "fat_g": 0.5}'::jsonb,
  'best_before',
  (select id from importers where tenant_id = (select id from tenants where slug = 'chloefood') and name = 'AFRICOOP Società Cooperativa' limit 1)
)
on conflict (tenant_id, slug) do update
  set ingredients_text = excluded.ingredients_text,
      conservation_instructions = excluded.conservation_instructions,
      country_of_origin = excluded.country_of_origin,
      packaging_material = excluded.packaging_material,
      net_quantity_display = excluded.net_quantity_display,
      nutrition_basis = excluded.nutrition_basis,
      nutrition = excluded.nutrition,
      durability_type = excluded.durability_type,
      importer_id = excluded.importer_id,
      updated_at = now();

-- ⚠️ producer_id NON impostato: la scheda "Garri Tapioca" non dichiara
-- esplicitamente il produttore ("Prodotto da"), a differenza di altre schede.
-- Verificare con AFRICOOP/Dalice prima di stampare l'etichetta definitiva.

-- 2. Pâte d'arachide 1kg — variante formato del prodotto già a catalogo (500g)
insert into products (
  tenant_id, category_id, name, slug, price, weight_grams, stock,
  active, featured, storage_type,
  ingredients_text, allergens_text, conservation_instructions,
  packaging_material, net_quantity_display, nutrition_basis, nutrition,
  durability_type, importer_id
)
values (
  (select id from tenants where slug = 'chloefood'),
  (select id from categories where slug = 'sauces-huiles' and tenant_id = (select id from tenants where slug = 'chloefood')),
  'Pâte d''arachide 1kg', 'pate-darachide-1kg', 0.00, 1000, 0, false, false, 'dry',
  'Arachide',
  'Arachidi',
  'Conservare in un luogo fresco e asciutto.',
  'vetro/plastica',
  '1 kg',
  '100g',
  '{"kj": 2625, "kcal": 634, "fat_g": 53, "saturated_fat_g": 8.0, "carbs_g": 8.5, "sugars_g": 5.4, "protein_g": 27, "salt_g": 0.8}'::jsonb,
  'best_before',
  (select id from importers where tenant_id = (select id from tenants where slug = 'chloefood') and name = 'AFRICOOP Società Cooperativa' limit 1)
)
on conflict (tenant_id, slug) do update
  set ingredients_text = excluded.ingredients_text,
      allergens_text = excluded.allergens_text,
      conservation_instructions = excluded.conservation_instructions,
      packaging_material = excluded.packaging_material,
      net_quantity_display = excluded.net_quantity_display,
      nutrition_basis = excluded.nutrition_basis,
      nutrition = excluded.nutrition,
      durability_type = excluded.durability_type,
      importer_id = excluded.importer_id,
      updated_at = now();

-- ⚠️ producer_id NON impostato: nemmeno la scheda "Pate Arachide" dichiara
-- esplicitamente "Prodotto da" — il gemello 500g esistente lo ha ereditato
-- solo dal link di default generico (migration 019). Verificare.

-- ─── DOPO L'ESECUZIONE ────────────────────────────────────────────────────
-- Vai su /admin/catalogue → cerca "Garri / Tapioca" e "Pâte d'arachide 1kg"
-- → imposta prezzo e stock reali → attiva (Actif = on).
