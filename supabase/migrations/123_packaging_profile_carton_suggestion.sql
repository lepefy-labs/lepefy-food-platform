-- MIGRATION 123: SUGGESTION DE CARTON PAR TRANCHE DE POIDS
--
-- Additive et réversible : deux colonnes nullable sur shipping_packaging_profiles.
-- Un profil actif dont suggest_max_weight_g est renseigné devient un carton
-- "de magasin" : le détail commande admin le suggère pour chaque colis dont le
-- poids p vérifie  coalesce(suggest_min_weight_g, 0) < p <= suggest_max_weight_g.
-- Plusieurs profils peuvent couvrir la même tranche : le premier par `position`
-- est le carton suggéré, les autres sont des alternatives (ex. carton L pour un
-- colis volumineux de 12,5–15 kg).
--
-- Aucune donnée existante modifiée ; le checkout (packaging_surcharges) n'est
-- pas concerné. Rollback :
--   alter table shipping_packaging_profiles
--     drop constraint if exists shipping_packaging_profiles_suggest_range,
--     drop column if exists suggest_min_weight_g,
--     drop column if exists suggest_max_weight_g;

alter table shipping_packaging_profiles
  add column if not exists suggest_min_weight_g int,
  add column if not exists suggest_max_weight_g int;

alter table shipping_packaging_profiles
  drop constraint if exists shipping_packaging_profiles_suggest_range;

alter table shipping_packaging_profiles
  add constraint shipping_packaging_profiles_suggest_range check (
    (suggest_min_weight_g is null or suggest_min_weight_g >= 0)
    and (suggest_max_weight_g is null or suggest_max_weight_g > 0)
    and (suggest_min_weight_g is null or suggest_max_weight_g is not null)
    and (suggest_min_weight_g is null or suggest_min_weight_g < suggest_max_weight_g)
  );

comment on column shipping_packaging_profiles.suggest_min_weight_g is
  'Borne basse exclusive (g) de la tranche de poids par colis pour laquelle ce carton est suggéré en préparation. Null = 0.';
comment on column shipping_packaging_profiles.suggest_max_weight_g is
  'Borne haute inclusive (g) de la tranche de poids par colis. Null = carton jamais suggéré (laboratoire uniquement).';
