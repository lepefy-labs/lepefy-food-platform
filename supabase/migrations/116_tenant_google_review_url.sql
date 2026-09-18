-- ─── MIGRATION 116: LIEN AVIS GOOGLE — CARD DIGITALE ─────────────────────────
-- Le module avis interne (113) est réservé aux commandes vérifiées : un
-- client qui achète uniquement en boutique physique (aucun flux de
-- création de commande "sur place" n'existe dans ce codebase) n'a jamais de
-- ligne `orders` et ne peut donc jamais laisser d'avis interne. Décision :
-- rediriger ces clients vers la fiche Google Business du tenant plutôt que
-- d'affaiblir le modèle "achat vérifié" existant.

alter table tenants add column if not exists google_review_url text;

comment on column tenants.google_review_url is
  'Lien "laisser un avis" de la fiche Google Business — configuré par le tenant. '
  'Utilisé sur la card digitale (/card) pour les clients sans commande vérifiée dans le système.';
