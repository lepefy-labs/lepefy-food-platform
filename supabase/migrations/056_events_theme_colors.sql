-- Palette personnalisable par événement (fallback vers tenant.primary_color /
-- tenant.secondary_color si null) — cf. évenementiel checkout 3 étapes.
alter table events
  add column theme_primary_color   text,
  add column theme_secondary_color text;

comment on column events.theme_primary_color is
  'Colore primario opzionale specifico per questo evento (es. tema BBQ arancione). '
  'Se null, la pagina usa tenant.primary_color. Formato hex, es. #E65C00.';
comment on column events.theme_secondary_color is
  'Colore secondario opzionale specifico per questo evento. Se null, usa tenant.secondary_color.';

-- Nessuna GRANT aggiuntiva: events ha già grant select a anon/authenticated
-- e grant all a service_role dalla migration 052 (copre anche le nuove colonne).
