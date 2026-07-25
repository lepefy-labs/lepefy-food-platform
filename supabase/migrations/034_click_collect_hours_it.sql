-- 034_click_collect_hours_it.sql
-- Versione italiana degli orari click & collect, editabile separatamente
-- dal francese perché il testo è libero e non traducibile in automatico
-- in modo affidabile per ogni tenant.
alter table tenants
  add column if not exists click_collect_hours_it text;

comment on column tenants.click_collect_hours_it is
  'Orari click & collect in italiano, mostrati su /card e checkout quando lang=it. Se null, fallback su click_collect_hours (francese).';
