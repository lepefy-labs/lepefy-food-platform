-- ─── MIGRATION: RESEED PRODUCTS — ChloeFood_Template_Catalogue_v2 (v2 slug) ─
-- Ripopola/aggiorna la tabella `products` del tenant 'chloefood' a partire
-- dal file sorgente Google Sheets "ChloeFood_Template_Catalogue_v2"
-- (121 prodotti, 8 categorie).
--
-- ⚠️ v2: slug corretti per allinearsi alla convenzione già in uso nel DB —
-- apostrofi, virgole e "+" vengono ELIMINATI senza inserire un trattino
-- (es. "Feuilles d'Okok" → feuilles-dokok, non feuilles-d-okok), a differenza
-- di spazi/slash che diventano "-". Verificato contro 10 prodotti reali già
-- presenti in tabella (query Check_ProdottiOrfani.sql) — la v1 di questo
-- script li avrebbe duplicati anziché aggiornarli.
--
-- Numerazione: 020 — primo numero libero dopo 019_link_default_producer.sql
-- (numerazione locale 001...019 presenta doppioni/gap noti, vedi LEPEFY_PROJECT_CONTEXT.md §4).
--
-- Idempotente: ON CONFLICT (tenant_id, slug) DO UPDATE — sicuro da rieseguire.
-- Non tocca producer_id / importer_id / campi etichetta / image_url / images /
-- description / position: se già valorizzati restano invariati.
--
-- Regole applicate:
--   • prezzo con virgola francese convertito in punto decimale
--   • 8 prodotti senza prezzo nel foglio → price = 0.00, active = false
--   • riga "Doppel" malformata nel foglio → categoria dedotta dalla sezione
--     "── BIÈRES ──" in cui si trova
--   • storage_type: Produits frais→fresh · Surgelés→frozen · resto→dry
--   • stock vuoto → 0 · peso vuoto → NULL

-- ─── 0. CATEGORIA "Boissons" — garantita presente (8ª categoria) ─────────────
insert into categories (tenant_id, name, slug, position)
select (select id from tenants where slug = 'chloefood'), 'Boissons', 'boissons', 8
where not exists (
  select 1 from categories
  where tenant_id = (select id from tenants where slug = 'chloefood') and slug = 'boissons'
);

-- ─── 1. PRODOTTI ──────────────────────────────────────────────────────────────
insert into products (
  tenant_id, category_id, name, slug, price, weight_grams, stock,
  active, featured, storage_type
)
values
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Pistaches Yaoundé moulus', 'pistaches-yaounde-moulus', 7.50, 500, 50, true, false, 'fresh'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Pistaches Yaoundé longs grains non moulus', 'pistaches-yaounde-longs-grains-non-moulus', 7.50, 500, 50, true, false, 'fresh'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'farines' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Mitoumba', 'mitoumba', 2.50, 300, 50, true, false, 'fresh'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Gingembre', 'gingembre', 5.00, 250, 16, true, false, 'fresh'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'farines' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Bobolo sous vide', 'bobolo-sous-vide', 3.00, 500, 1000, true, true, 'fresh'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'farines' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Chikwang', 'chikwang', 1.50, 500, 50, true, false, 'fresh'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Feuilles de watalif', 'feuilles-de-watalif', 6.00, 500, 20, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Folong frais (légumes The Chef)', 'folong-frais-legumes-the-chef', 8.50, 1000, 20, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Zom frais (légumes The Chef)', 'zom-frais-legumes-the-chef', 8.50, 1000, 40, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Ndolè frais (légumes The Chef)', 'ndole-frais-legumes-the-chef', 4.00, 500, 60, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Saka Saka / Feuilles de manioc', 'saka-saka-feuilles-de-manioc', 2.50, 500, 50, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Okong-Obong frais (légumes The Chef)', 'okong-obong-frais-legumes-the-chef', 8.50, 900, 10, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Feuilles d''Okok', 'feuilles-dokok', 5.00, 100, 40, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'farines' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Miondo', 'miondo', 6.00, 1000, 50, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Gombo frais découpé', 'gombo-frais-decoupe', 2.00, 150, 20, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'farines' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Atiéké Ivoirien', 'atieke-ivoirien', 5.00, 900, 20, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Prunes / Safou', 'prunes-safou', 8.00, 500, 20, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Biteku Teku / Feuilles de folon', 'biteku-teku-feuilles-de-folon', 3.50, 500, 50, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'farines' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Waterfufu', 'waterfufu', 4.00, 500, 50, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'sauces-huiles' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Noix de palmiste pilé / Sauce graine', 'noix-de-palmiste-pile-sauce-graine', 3.50, 500, 100, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'farines' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Chikwang Bateke', 'chikwang-bateke', 2.00, 300, 100, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Maïs grains', 'mais-grains', 6.00, 1000, 0, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Maïs dépulpé', 'mais-depulpe', 6.00, 1000, 20, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'poissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Morue fumée', 'morue-fumee', 12.00, 250, 30, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'poissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Poisson salé', 'poisson-sale', 60.00, 3500, 6, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'poissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Thon', 'thon', 0.00, NULL, 0, false, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'poissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Poisson Bar', 'poisson-bar', 10.00, 1000, 150, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'poissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Maquereau Oya Oya 500+', 'maquereau-oya-oya-500', 10.00, 1000, 80, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'poissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Escargots', 'escargots', 10.00, 100, 40, true, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Plantains mûrs découpés', 'plantains-murs-decoupes', 0.00, NULL, 0, false, false, 'frozen'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'poissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'La Raie / Cover Pot', 'la-raie-cover-pot', 12.00, 250, 5, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Ails', 'ails', 5.00, 250, 20, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Ignames', 'ignames', 8.00, 1000, 0, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Taro', 'taro', 6.00, 1000, 0, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Sel gemme', 'sel-gemme', 5.00, 300, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Bitakola', 'bitakola', 3.00, 150, 20, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Kaolin', 'kaolin', 2.50, 150, 400, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Manyanga blanc', 'manyanga-blanc', 15.00, 1000, 5, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Manyanga noir', 'manyanga-noir', 18.00, 1000, 5, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'sauces-huiles' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Beurre de karité', 'beurre-de-karite', 20.00, 1000, 5, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'sauces-huiles' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Huile rouge 1L', 'huile-rouge-1l', 6.00, 1000, 150, true, true, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'sauces-huiles' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Huile rouge 5L', 'huile-rouge-5l', 0.00, NULL, 0, false, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Koki dépulpé', 'koki-depulpe', 3.50, 500, 100, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Koki non dépulpé', 'koki-non-depulpe', 5.00, 1000, 20, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Haricots rouges gros grains', 'haricots-rouges-gros-grains', 3.50, 500, 80, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Haricots rouges petits grains', 'haricots-rouges-petits-grains', 3.50, 500, 60, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Haricots noirs', 'haricots-noirs', 3.50, 500, 100, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Haricots blancs', 'haricots-blancs', 3.50, 500, 50, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Pistaches Egusi', 'pistaches-egusi', 7.50, 500, 50, true, true, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Pistaches Egusi écrasés', 'pistaches-egusi-ecrases', 7.50, 500, 50, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Pistaches Yaoundé longs grains', 'pistaches-yaounde-longs-grains', 7.50, 500, 50, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'farines' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Foufou / Farine de manioc', 'foufou-farine-de-manioc', 5.00, 1000, 120, true, true, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'poissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Crevettes séchées', 'crevettes-sechees', 5.00, 100, 300, true, true, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'snacks' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Arachides dépulpés (Ndole)', 'arachides-depulpes-ndole', 3.50, 500, 300, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'snacks' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Arachides du village', 'arachides-du-village', 8.00, 500, 10, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'farines' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Farine de maïs', 'farine-de-mais', 6.00, 1000, 30, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Maïs dépulpé (contchap)', 'mais-depulpe-contchap', 6.00, 1000, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Okok séché', 'okok-seche', 5.00, 100, 50, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Folong', 'folong', 2.50, 500, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Ndolè séché', 'ndole-seche', 5.00, 250, 50, true, true, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'snacks' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Chips de Plantains', 'chips-de-plantains', 1.00, 80, 0, true, true, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'snacks' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Maïs grillé avec l''arachide', 'mais-grille-avec-larachide', 5.00, 250, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'snacks' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Croquettes', 'croquettes', 0.00, NULL, 0, false, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'snacks' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Caramel', 'caramel', 0.00, NULL, 0, false, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'snacks' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Arachides grillées', 'arachides-grillees', 0.00, NULL, 0, false, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'snacks' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Mambo / Chocolat au lait', 'mambo-chocolat-au-lait', 1.00, 23, 100, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Cube Maggi', 'cube-maggi', 4.00, 500, 50, true, true, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Cube Maggi Crevette', 'cube-maggi-crevette', 6.50, 500, 50, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'legumes' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Bissap', 'bissap', 2.00, 100, 300, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'snacks' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Tartina Chocolat 380g', 'tartina-chocolat-380g', 6.00, 380, 25, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'snacks' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Tartina Chocolat 740g', 'tartina-chocolat-740g', 10.00, 740, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'sauces-huiles' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Pâte d''arachide', 'pate-darachide', 4.00, 500, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Nkui', 'nkui', 5.00, 100, 25, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Djansang', 'djansang', 5.00, 250, 40, true, true, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Poivre Blanc de Penja entier', 'poivre-blanc-de-penja-entier', 5.00, 100, 50, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Poivre Blanc de Penja moulu', 'poivre-blanc-de-penja-moulu', 5.00, 100, 50, true, true, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'viandes-sechees' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Kilichi pimenté', 'kilichi-pimente', 10.00, 150, 10, true, true, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'viandes-sechees' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Kilichi non pimenté', 'kilichi-non-pimente', 10.00, 150, 10, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Rondelle en poudre', 'rondelle-en-poudre', 5.00, 100, 10, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Jujube', 'jujube', 10.00, 60, 10, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Sok', 'sok', 10.00, 60, 10, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Clou de Girofle', 'clou-de-girofle', 10.00, 100, 10, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Épice Nkui du Cameroun', 'epice-nkui-du-cameroun', 5.00, 100, 20, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Secret Taro', 'secret-taro', 5.00, 100, 20, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Secret Poulet', 'secret-poulet', 5.00, 100, 30, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Secret Viande', 'secret-viande', 5.00, 100, 30, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Secret Poisson', 'secret-poisson', 5.00, 100, 20, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Secret Kondrè', 'secret-kondre', 5.00, 100, 10, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Épice The Chef Poisson 8g', 'epice-the-chef-poisson-8g', 1.00, 8, 50, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Épice The Chef Poisson 100g', 'epice-the-chef-poisson-100g', 5.00, 100, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Épice The Chef Viande 8g', 'epice-the-chef-viande-8g', 1.00, 8, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Épice The Chef Poulet 100g', 'epice-the-chef-poulet-100g', 5.00, 100, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Épice The Chef Ail 7g', 'epice-the-chef-ail-7g', 1.00, 7, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Épice The Chef Ail+Gingembre 7g', 'epice-the-chef-ailgingembre-7g', 1.00, 7, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Épice The Chef Rondelle 8g', 'epice-the-chef-rondelle-8g', 1.00, 8, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Épice The Chef Kankan légèrement pimenté 100g', 'epice-the-chef-kankan-legerement-pimente-100g', 5.00, 100, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Épice The Chef Piment 10g', 'epice-the-chef-piment-10g', 1.00, 10, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Épice The Chef Poivre blanc 7g', 'epice-the-chef-poivre-blanc-7g', 1.00, 7, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Épice The Chef Pépé+Piment 7g', 'epice-the-chef-pepepiment-7g', 1.00, 7, 40, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'snacks' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Grattoir', 'grattoir', 5.00, 100, 8, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'snacks' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Bomme François', 'bomme-francois', 3.00, 10, 20, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Mutzig', 'mutzig', 6.00, 1200, 24, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Orijin', 'orijin', 7.00, 1200, 24, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    '"33" Export', '33-export', 6.00, 1200, 24, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Grande Guinness', 'grande-guinness', 8.00, 1200, 24, true, true, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Petite Guinness', 'petite-guinness', 4.00, 700, 48, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Kadji Beer', 'kadji-beer', 6.00, 1200, 60, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Isenbeck', 'isenbeck', 7.00, 1200, 48, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Beaufort', 'beaufort', 6.00, 1200, 24, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Casteel', 'casteel', 7.00, 1200, 24, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Malta Guinness', 'malta-guinness', 4.00, 700, 24, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Doppel', 'doppel', 7.00, 1200, 24, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Booster', 'booster', 7.00, 1200, 24, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Top Grenadine', 'top-grenadine', 5.00, 1200, 24, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Spécial Pamplemousse UCB', 'special-pamplemousse-ucb', 5.00, 1200, 24, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'D''jino Cocktail de fruits (verre)', 'djino-cocktail-de-fruits-verre', 5.00, 1200, 0, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Top Ananas', 'top-ananas', 5.00, 1200, 0, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'D''jino Cocktail de fruits (plastique)', 'djino-cocktail-de-fruits-plastique', 5.00, 1200, 0, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Vimto', 'vimto', 5.00, 1200, 24, true, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Acqua Fonte dei Marchesi 0,5L', 'acqua-fonte-dei-marchesi-05l', 0.00, NULL, 0, false, false, 'dry'
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'boissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Acqua Saguaro 0,5L', 'acqua-saguaro-05l', 0.00, NULL, 0, false, false, 'dry'
  )
on conflict (tenant_id, slug) do update
  set category_id  = excluded.category_id,
      price        = excluded.price,
      weight_grams = excluded.weight_grams,
      stock        = excluded.stock,
      active       = excluded.active,
      featured     = excluded.featured,
      storage_type = excluded.storage_type,
      updated_at   = now();

-- ─── 2. VERIFICA POST-IMPORT ─────────────────────────────────────────────────
-- select count(*) from products where tenant_id = (select id from tenants where slug = 'chloefood');
-- -- atteso: 121 + eventuali orfani non sovrapposti (es. "Bobolo surgelé") non toccati da questo script
-- select count(*) from products where tenant_id = (select id from tenants where slug = 'chloefood') and active = false;
-- -- atteso: 8 nuovi + quelli già presenti invariati
-- select count(*) from products where tenant_id = (select id from tenants where slug = 'chloefood') and featured = true;
-- -- atteso: 12
