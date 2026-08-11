-- ─── MIGRATION 058: HERO HIGHLIGHTS + BADGE FORMULE (Événementiel Fase 2) ──
-- Palette: default fisso del modulo (non più legato al tenant) — vedi
-- evenements/[slug]/page.tsx, che ora usa EVENT_MODULE_DEFAULT_PRIMARY /
-- EVENT_MODULE_DEFAULT_SECONDARY invece del fallback a tenant.primary_color.
-- La colonna override per-evento (056) resta invariata, solo il fallback cambia.
alter table events alter column theme_primary_color   set default '#E65C00';
alter table events alter column theme_secondary_color set default '#FFB347';
update events
set theme_primary_color   = coalesce(theme_primary_color,   '#E65C00'),
    theme_secondary_color = coalesce(theme_secondary_color, '#FFB347');

alter table events add column subtitle   text;
alter table events add column highlights jsonb;

comment on column events.subtitle is
  'Sottotitolo opzionale sotto il titolo (es. "La Première"). Null = non mostrato.';
comment on column events.highlights is
  'Array opzionale di massimo 3 oggetti {icon: string (chiave da registro '
  'icone fisso, vedi HIGHLIGHT_ICONS in EventCheckoutClient o file dedicato), '
  'title: string, text: string}. Null o array vuoto = sezione nascosta. '
  'Esempio: [{"icon":"flame","title":"Braises authentiques","text":"Des '
  'grillades préparées directement sur le feu."}]';

alter table event_ticket_types add column badge text;
comment on column event_ticket_types.badge is
  'Badge testuale opzionale sulla card formula (es. "LA PLUS POPULAIRE"). '
  'Null = nessun badge mostrato.';

-- Nessuna nuova grant: events e event_ticket_types hanno già le grant di
-- service_role/anon/authenticated dalla migration 052 (select anon/authenticated,
-- all service_role) — verificato che 053/054/055/056/057 non le modifichino.
-- Le nuove colonne sono coperte automaticamente (grant a livello di tabella).
