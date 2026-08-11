-- Index dédié aux requêtes par événement (carousel multi-image auto-fade,
-- hub /evenementiel + détail /evenementiel/evenements/[slug]). L'index
-- existant idx_event_gallery_photos_tenant (052) sert la galerie générale
-- (tenant_id, sort_order) ; celui-ci accélère le filtre event_id, partiel
-- car la majorité des photos de galerie n'est pas rattachée à un événement.
create index if not exists idx_event_gallery_photos_event
  on event_gallery_photos(tenant_id, event_id, sort_order)
  where event_id is not null;

-- Aucune modification RLS/GRANT : la policy publique "event_gallery_photos_select_public"
-- (052, using (true)) couvre déjà ce cas d'usage.
