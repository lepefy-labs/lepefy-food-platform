-- ─── MIGRATION 024: PALETTE COLORE E BADGE "100% NATURALE" PER LE ETICHETTE ──

alter table label_print_jobs
  add column if not exists palette        text not null default 'blu_epices'
                              check (palette in ('verde_palma', 'blu_epices', 'terra_piccante')),
  add column if not exists natural_badge  boolean not null default false;

comment on column label_print_jobs.palette is
  'Palette colore scelta per questa etichetta (indipendente da tenants.primary_color/secondary_color). '
  'Selezionabile per ogni bozza, come template_key.';
comment on column label_print_jobs.natural_badge is
  'Se true, mostra il bollino "100% Naturale" sull''etichetta. Scelta libera per singola stampa, '
  'non una certificazione di prodotto (a differenza di products.gluten_free_certified).';
