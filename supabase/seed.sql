-- ─── CHLOÉFOOD TENANT ─────────────────────────────────────────────────────────
insert into tenants (
  slug, name, tagline, primary_color, secondary_color, accent_light,
  city, country, currency, locale, click_collect_enabled,
  click_collect_address
) values (
  'chloefood',
  'Chloé Food ETS',
  'Les saveurs de chez nous',
  '#1D9E75',
  '#F2C811',
  '#E1F5EE',
  'Reggio Emilia',
  'IT',
  'EUR',
  'fr-FR',
  true,
  'Via Angelo Zanti 1, 42122 Reggio Emilia, Italia'
);

-- ─── CATEGORIES ───────────────────────────────────────────────────────────────
insert into categories (tenant_id, name, slug, position) values
  ((select id from tenants where slug = 'chloefood'), 'Épices',          'epices',         1),
  ((select id from tenants where slug = 'chloefood'), 'Légumes',         'legumes',        2),
  ((select id from tenants where slug = 'chloefood'), 'Snacks',          'snacks',         3),
  ((select id from tenants where slug = 'chloefood'), 'Sauces & Huiles', 'sauces-huiles',  4),
  ((select id from tenants where slug = 'chloefood'), 'Farines',         'farines',        5),
  ((select id from tenants where slug = 'chloefood'), 'Poissons',        'poissons',       6),
  ((select id from tenants where slug = 'chloefood'), 'Viandes séchées', 'viandes-sechees',7);

-- ─── SAMPLE PRODUCTS ──────────────────────────────────────────────────────────
insert into products (tenant_id, category_id, name, slug, description, price, weight_grams, stock, featured) values
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Poivre de Penja', 'poivre-de-penja',
    'Poivre blanc de Penja, AOP du Cameroun. Notes florales et légèrement musquées.',
    8.50, 100, 50, true
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'epices' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Djansang moulu', 'djansang-moulu',
    'Graines de Ricinodendron heudelotii moulues. Indispensable dans la cuisine camerounaise.',
    5.90, 200, 80, false
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'farines' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Farine de manioc (gari)', 'farine-manioc-gari',
    'Gari blanc finement moulu, prêt à l''emploi. Idéal pour le foufou.',
    4.50, 1000, 120, true
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'sauces-huiles' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Huile de palme rouge', 'huile-palme-rouge',
    'Huile de palme rouge non raffinée, extraite artisanalement.',
    7.90, 900, 60, true
  ),
  (
    (select id from tenants where slug = 'chloefood'),
    (select id from categories where slug = 'poissons' and tenant_id = (select id from tenants where slug = 'chloefood')),
    'Poisson fumé (capitaine)', 'poisson-fume-capitaine',
    'Capitaine fumé entier, goût intense. Base de nombreux plats africains.',
    12.00, 500, 40, false
  );

-- ─── SHIPPING ZONES ───────────────────────────────────────────────────────────
insert into shipping_zones (tenant_id, name, countries, free_above, position) values
  ((select id from tenants where slug = 'chloefood'), 'Italie',          '{IT}',             70.00, 1),
  ((select id from tenants where slug = 'chloefood'), 'France & Belux',  '{FR,BE,LU}',       90.00, 2),
  ((select id from tenants where slug = 'chloefood'), 'Europe proche',   '{DE,CH,AT,NL,ES,PT}', 110.00, 3),
  ((select id from tenants where slug = 'chloefood'), 'Europe éloignée', '{PL,SE,DK,IE,CZ,HU}', 130.00, 4);

-- ─── SHIPPING RATES ───────────────────────────────────────────────────────────
insert into shipping_rates (tenant_id, zone_id, min_weight_g, max_weight_g, rate)
select
  (select id from tenants where slug = 'chloefood'),
  z.id,
  r.min_g,
  r.max_g,
  r.rate
from shipping_zones z
join (values
  ('Italie',            0,      500,    4.50),
  ('Italie',          501,     1000,   5.90),
  ('Italie',         1001,     2000,   7.50),
  ('Italie',         2001,     5000,  10.50),
  ('Italie',         5001,    10000,  14.00),
  ('Italie',        10001,    20000,  20.00),
  ('Italie',        20001,     null,  28.00),
  ('France & Belux',    0,      500,   8.50),
  ('France & Belux',  501,     1000,  10.50),
  ('France & Belux', 1001,     2000,  13.50),
  ('France & Belux', 2001,     5000,  18.50),
  ('France & Belux', 5001,    10000,  26.00),
  ('France & Belux',10001,    20000,  38.00),
  ('France & Belux',20001,     null,  52.00),
  ('Europe proche',     0,      500,  10.50),
  ('Europe proche',   501,     1000,  13.00),
  ('Europe proche',  1001,     2000,  16.50),
  ('Europe proche',  2001,     5000,  23.00),
  ('Europe proche',  5001,    10000,  33.00),
  ('Europe proche', 10001,    20000,  48.00),
  ('Europe proche', 20001,     null,  65.00),
  ('Europe éloignée',   0,      500,  12.50),
  ('Europe éloignée', 501,     1000,  15.50),
  ('Europe éloignée',1001,     2000,  20.00),
  ('Europe éloignée',2001,     5000,  28.00),
  ('Europe éloignée',5001,    10000,  40.00),
  ('Europe éloignée',10001,   20000,  58.00),
  ('Europe éloignée',20001,    null,  78.00)
) as r(zone_name, min_g, max_g, rate)
  on z.name = r.zone_name
where z.tenant_id = (select id from tenants where slug = 'chloefood');
