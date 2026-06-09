-- ─── MIGRATION 003b: DIMENSIONI PACCO IN packaging_surcharges ────────────────
-- Aggiunge larghezza, altezza e lunghezza standard del pacco alla tabella
-- packaging_surcharges, in modo da rendere le dimensioni configurabili in DB
-- senza toccare il codice.
--
-- Valori iniziali: 40×30×20 cm (usati nei test Packlink PRO del 09/06/2026)
-- Packlink usa le dimensioni per calcolare il peso volumetrico:
--   peso_vol = (length × width × height) / 5000
-- Se peso_vol > peso_reale, il corriere applica la tariffa sul peso volumetrico.

alter table packaging_surcharges
  add column if not exists box_length_cm int not null default 40,
  add column if not exists box_width_cm  int not null default 30,
  add column if not exists box_height_cm int not null default 20;

comment on column packaging_surcharges.box_length_cm is
  'Lunghezza standard scatola in cm — usata per calcolo peso volumetrico Packlink';
comment on column packaging_surcharges.box_width_cm is
  'Larghezza standard scatola in cm';
comment on column packaging_surcharges.box_height_cm is
  'Altezza standard scatola in cm';

-- Aggiorna il seed ChloeFood con le dimensioni usate nei test
update packaging_surcharges
set
  box_length_cm = 40,
  box_width_cm  = 30,
  box_height_cm = 20
where tenant_id = (select id from tenants where slug = 'chloefood');
