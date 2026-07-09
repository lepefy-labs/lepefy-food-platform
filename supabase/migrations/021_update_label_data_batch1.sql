-- ─── UPDATE DATI ETICHETTA — 22 prodotti esistenti ───────────────────────────
-- Fonte: "20260708 - Data base etiquettes Chloé Food.xlsx"
-- Abbinamenti e ambiguità risolte confermate da Robertin il 09/07/2026:
--   • Fagioli Rossi (generico) → Haricots rouges petits grains
--   • Haricot Rouge Long → Haricots rouges gros grains
--   • Koki Beans → applicato sia a Koki dépulpé che Koki non dépulpé
--   • Mais Depulpe → Maïs dépulpé (contchap), variante Produits secs
--   • Semi di Zucca (non moulu) → Pistaches Yaoundé longs grains non moulus (Produits frais)
--
-- ⚠️ durability_type impostato a 'best_before' per tutti — ogni scheda originale
-- usa "da consumarsi preferibilmente entro" (TMC), mai "da consumarsi entro" (scadenza).
-- Lotto e data di scadenza NON sono qui: vanno inseriti al momento della stampa
-- in label_print_jobs (cambiano ad ogni produzione).
--
-- ⚠️ Leggere i commenti "⚠️" per ogni prodotto PRIMA di stampare etichette reali:
-- alcuni valori nutrizionali sono identici tra prodotti diversi (probabile
-- copia-incolla nel file sorgente) e vanno riverificati col produttore.

-- bobolo-sous-vide
update products set
  ingredients_text = 'Manioca',
  allergens_text = NULL,
  conservation_instructions = 'Conservare in un luogo fresco e asciutto',
  usage_instructions = 'Riscaldare per 8 minuti senza aprire la confezione a bagnomaria',
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '500 g',
  nutrition_basis = '100g',
  nutrition = '{"kj": 670, "kcal": 160, "fat_g": 0.2, "saturated_fat_g": 0, "carbs_g": 48, "sugars_g": 2.5, "protein_g": 5.6, "fiber_g": 1.8, "salt_g": 0}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'bobolo-sous-vide';

-- miondo
update products set
  ingredients_text = 'Manioca',
  allergens_text = NULL,
  conservation_instructions = 'Conservare in un freezer. Una volta scongelato, il prodotto non deve essere più ricongelato',
  usage_instructions = 'Riscaldare per 15 minuti a bagnomaria',
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '1 kg',
  nutrition_basis = '100g',
  nutrition = '{"kj": 670, "kcal": 160, "fat_g": 0.2, "saturated_fat_g": 0, "carbs_g": 48, "sugars_g": 2.5, "protein_g": 5.6, "fiber_g": 1.8, "salt_g": 0}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'miondo';

-- foufou-farine-de-manioc
update products set
  ingredients_text = '100% manioca',
  allergens_text = NULL,
  conservation_instructions = 'Da conservare a temperatura ambiente',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '1 kg',
  nutrition_basis = '100g',
  nutrition = '{"kcal": 140, "protein_g": 2.97, "carbs_g": 35, "fat_g": 0.5, "fiber_g": 1.8}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'foufou-farine-de-manioc';

-- chikwang
-- ⚠️ Valori nutrizionali espressi in % nel foglio originale (Proteine 1.4%, Carboidrati 38.06%, ecc.) — trattati come g/100g per coerenza col resto del catalogo. DA VERIFICARE col produttore.
update products set
  ingredients_text = '100% manioca',
  allergens_text = NULL,
  conservation_instructions = 'Da conservare a temperatura ambiente',
  usage_instructions = 'Riscaldare per 15 minuti senza aprire la confezione a bagnomaria',
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '500 g',
  nutrition_basis = '100g',
  nutrition = '{"kcal": 159, "protein_g": 1.4, "carbs_g": 38.06, "fat_g": 0.2, "fiber_g": 1.8}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'chikwang';

-- chikwang-bateke
-- ⚠️ ⚠️ DISCREPANZA NON RISOLTA: scheda etichetta indica 500g e conservazione a temperatura ambiente, ma il prodotto a catalogo è 300g / Surgelés (congelato). Peso/weight_grams NON aggiornato in questo script — verificare con Dalice prima di stampare l'etichetta.
update products set
  ingredients_text = '100% manioca',
  allergens_text = NULL,
  conservation_instructions = 'Da conservare a temperatura ambiente',
  usage_instructions = 'Riscaldare per 8 minuti senza aprire la confezione a bagnomaria',
  country_of_origin = 'Congo',
  packaging_material = 'plastica',
  net_quantity_display = '500 g',
  nutrition_basis = '100g',
  nutrition = '{"kcal": 159, "protein_g": 1.4, "carbs_g": 38.06, "fat_g": 0.2, "fiber_g": 1.8}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'chikwang-bateke';

-- haricots-rouges-petits-grains
-- ⚠️ Scheda 'Fagioli Rossi' (generica) — confermato da Robertin = petits grains.
update products set
  ingredients_text = 'Fagioli rossi',
  allergens_text = NULL,
  conservation_instructions = 'Conservare a temperatura ambiente',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '500 g',
  nutrition_basis = '100g',
  nutrition = '{"kcal": 159, "protein_g": 1.4, "carbs_g": 38.06, "fat_g": 0.2, "fiber_g": 1.8}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'haricots-rouges-petits-grains';

-- haricots-rouges-gros-grains
-- ⚠️ Scheda 'Haricot Rouge Long' — confermato da Robertin = gros grains.
update products set
  ingredients_text = 'Fagioli rossi',
  allergens_text = NULL,
  conservation_instructions = 'Conservare in luogo fresco e asciutto',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '500 g',
  nutrition_basis = '100g',
  nutrition = '{"kcal": 333, "carbs_g": 60, "protein_g": 24, "fat_g": 1}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'haricots-rouges-gros-grains';

-- haricots-noirs
-- ⚠️ ⚠️ Valori nutrizionali identici byte-per-byte alla scheda 'Faglioli cannellini' — plausibile per legumi secchi ma non ancora verificato col produttore.
update products set
  ingredients_text = 'Fagioli Neri',
  allergens_text = NULL,
  conservation_instructions = 'Conservare in un luogo fresco e asciutto, al riparo dalla luce e dal calore',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '500 g',
  nutrition_basis = '100g',
  nutrition = '{"kj": 1371, "kcal": 325, "fat_g": 1.6, "saturated_fat_g": 0, "carbs_g": 46, "sugars_g": 2.9, "fiber_g": 17, "protein_g": 23, "salt_g": 0.01}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'haricots-noirs';

-- haricots-blancs
-- ⚠️ ⚠️ Valori nutrizionali identici byte-per-byte alla scheda 'Fagliolio neri' — plausibile per legumi secchi ma non ancora verificato col produttore.
update products set
  ingredients_text = 'Fagioli cannellini',
  allergens_text = NULL,
  conservation_instructions = 'Conservare in un luogo fresco e asciutto, al riparo dalla luce e del calore',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '500 g',
  nutrition_basis = '100g',
  nutrition = '{"kj": 1371, "kcal": 325, "fat_g": 1.6, "saturated_fat_g": 0, "carbs_g": 46, "sugars_g": 2.9, "fiber_g": 17, "protein_g": 23, "salt_g": 0.01}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'haricots-blancs';

-- koki-depulpe
-- ⚠️ Scheda 'Koki Beans' applicata sia a dépulpé che non dépulpé su conferma di Robertin (nessun dato nutrizionale nella scheda originale).
update products set
  ingredients_text = 'Fagioli',
  allergens_text = NULL,
  conservation_instructions = 'Da conservare a temperatura ambiente',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '500 g',
  nutrition_basis = '100g',
  nutrition = NULL,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'koki-depulpe';

-- koki-non-depulpe
-- ⚠️ Scheda 'Koki Beans' applicata sia a dépulpé che non dépulpé su conferma di Robertin (nessun dato nutrizionale nella scheda originale).
update products set
  ingredients_text = 'Fagioli',
  allergens_text = NULL,
  conservation_instructions = 'Da conservare a temperatura ambiente',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '1000 g',
  nutrition_basis = '100g',
  nutrition = NULL,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'koki-non-depulpe';

-- okok-seche
update products set
  ingredients_text = 'Foglie di Okok (Gnetum africanum)',
  allergens_text = NULL,
  conservation_instructions = 'Conservare in luogo fresco e asciutto al riparo da fonti di luce e di calore',
  usage_instructions = NULL,
  country_of_origin = NULL,
  packaging_material = 'plastica',
  net_quantity_display = '100 g',
  nutrition_basis = '100g',
  nutrition = NULL,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'okok-seche';

-- crevettes-sechees
-- ⚠️ Allergene Crostacei dedotto dal nome ingrediente 'Gamberetti/Crostacei' — VERIFICARE che sia dichiarato esplicitamente prima di pubblicare l'etichetta definitiva.
update products set
  ingredients_text = 'Gamberetti / Crostacei',
  allergens_text = 'Crostacei',
  conservation_instructions = 'Conservare in un luogo fresco e asciutto. Da consumare previa cottura.',
  usage_instructions = NULL,
  country_of_origin = NULL,
  packaging_material = 'plastica',
  net_quantity_display = '100 g',
  nutrition_basis = '100g',
  nutrition = '{"kj": 334, "kcal": 80, "fat_g": 1, "saturated_fat_g": 1, "carbs_g": 0, "sugars_g": 0, "fiber_g": 1, "salt_g": 0.98}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'crevettes-sechees';

-- farine-de-mais
update products set
  ingredients_text = '100% mais',
  allergens_text = NULL,
  conservation_instructions = 'Conservare in luogo fresco e asciutto',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '1 kg',
  nutrition_basis = '100g',
  nutrition = '{"kcal": 350, "carbs_g": 75, "protein_g": 7, "fat_g": 1.5}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'farine-de-mais';

-- mais-depulpe-contchap
-- ⚠️ Scheda 'Mais Depulpe' — confermato da Robertin = variante contchap (Produits secs), non la variante Surgelés.
update products set
  ingredients_text = 'Mais',
  allergens_text = NULL,
  conservation_instructions = 'Da conservare a temperatura ambiente',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = NULL,
  net_quantity_display = '1 kg',
  nutrition_basis = '100g',
  nutrition = '{"kcal": 365, "carbs_g": 74, "protein_g": 9.4, "fat_g": 4.7}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'mais-depulpe-contchap';

-- pate-darachide
update products set
  ingredients_text = 'Arachide',
  allergens_text = 'Arachidi',
  conservation_instructions = 'Conservare in un luogo fresco e asciutto.',
  usage_instructions = NULL,
  country_of_origin = NULL,
  packaging_material = 'vetro/plastica',
  net_quantity_display = '500 g',
  nutrition_basis = '100g',
  nutrition = '{"kj": 2625, "kcal": 634, "fat_g": 53, "saturated_fat_g": 8.0, "carbs_g": 8.5, "sugars_g": 5.4, "protein_g": 27, "salt_g": 0.8}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'pate-darachide';

-- huile-rouge-1l
-- ⚠️ Il foglio riporta un range per i grassi saturi (47-50g) e distingue mono/polinsaturi — jsonb nutrition semplificato a un valore medio (48.5g); rivedere se serve maggiore precisione in etichetta.
update products set
  ingredients_text = '100% olio di palma',
  allergens_text = NULL,
  conservation_instructions = 'Da conservare a temperatura ambiente, in luogo fresco e asciutto, al riparo dalla luce diretta del sole.',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '1 L',
  nutrition_basis = '100ml',
  nutrition = '{"kj": 3880, "kcal": 920, "fat_g": 99.9, "saturated_fat_g": 48.5, "salt_g": 0}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'huile-rouge-1l';

-- bissap
update products set
  ingredients_text = 'Fiori di ibisco',
  allergens_text = NULL,
  conservation_instructions = 'Conservare in luogo fresco e asciutto',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '100 g',
  nutrition_basis = '100g',
  nutrition = NULL,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'bissap';

-- chips-de-plantains
update products set
  ingredients_text = 'Plantano, olio, sale',
  allergens_text = NULL,
  conservation_instructions = 'Conservare in luogo fresco e asciutto',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '80 g',
  nutrition_basis = '100g',
  nutrition = '{"kcal": 520, "fat_g": 30, "carbs_g": 60, "protein_g": 2, "salt_g": 1}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'chips-de-plantains';

-- arachides-du-village
update products set
  ingredients_text = '100% arachidi',
  allergens_text = 'Arachidi',
  conservation_instructions = 'Conservare in luogo fresco e asciutto',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '500 g',
  nutrition_basis = '100g',
  nutrition = '{"kcal": 567, "fat_g": 49, "carbs_g": 16, "protein_g": 26}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'arachides-du-village';

-- arachides-depulpes-ndole
update products set
  ingredients_text = 'Arachidi',
  allergens_text = 'Arachidi',
  conservation_instructions = 'Conservare in luogo fresco e asciutto',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '500 g',
  nutrition_basis = '100g',
  nutrition = '{"kcal": 567, "fat_g": 49, "carbs_g": 16, "protein_g": 26}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'arachides-depulpes-ndole';

-- pistaches-yaounde-longs-grains-non-moulus
-- ⚠️ Scheda 'Semi di Zucca' — confermato da Robertin = variante non moulu, Produits frais (non la variante Produits secs).
update products set
  ingredients_text = '100% semi di zucca',
  allergens_text = NULL,
  conservation_instructions = 'Conservare in luogo fresco e asciutto',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '500 g',
  nutrition_basis = '100g',
  nutrition = '{"kcal": 559, "fat_g": 49, "carbs_g": 11, "protein_g": 30}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'pistaches-yaounde-longs-grains-non-moulus';

-- pistaches-yaounde-moulus
update products set
  ingredients_text = '100% semi di zucca',
  allergens_text = NULL,
  conservation_instructions = 'Conservare in luogo fresco e asciutto',
  usage_instructions = NULL,
  country_of_origin = 'Camerun',
  packaging_material = 'plastica',
  net_quantity_display = '500 g',
  nutrition_basis = '100g',
  nutrition = '{"kcal": 559, "fat_g": 49, "carbs_g": 11, "protein_g": 30}'::jsonb,
  durability_type = 'best_before',
  updated_at = now()
where tenant_id = (select id from tenants where slug = 'chloefood')
  and slug = 'pistaches-yaounde-moulus';
