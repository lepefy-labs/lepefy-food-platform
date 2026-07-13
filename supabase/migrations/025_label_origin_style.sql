-- ─── MIGRATION 025: STILE BANDIERA ORIGINE PER LE ETICHETTE ──────────────────

alter table label_print_jobs
  add column if not exists origin_style  text not null default 'pill'
                              check (origin_style in ('pill', 'block', 'medallion'));

comment on column label_print_jobs.origin_style is
  'Stile con cui viene mostrata la bandiera del paese di origine sull''etichetta: '
  'pill = bandierina nell''asola esistente, block = blocco grafico più grande, '
  'medallion = bollino circolare nel pannello foto con testo curvo. '
  'Selezionabile per ogni bozza, come palette e natural_badge.';
