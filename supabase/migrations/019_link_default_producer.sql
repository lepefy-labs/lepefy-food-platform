-- ─── MIGRATION 019: LINK TEMPORANEO PRODUCTS → PRODUCER/IMPORTER DI DEFAULT ──
-- Collega tutti i prodotti che non hanno ancora producer_id/importer_id al
-- default seedato nella 017 (Africa Food Services / Africoop). Provvisorio:
-- prodotti con produttore diverso (es. Maggi Cube → Nestlé Cameroun) vanno
-- ricollegati manualmente dall'admin una volta pronta la UI (vedi prompt
-- ClaudeCode_Prompt_ProducerImporterUI.md).

update products
set producer_id = (select id from producers where tenant_id = products.tenant_id and name = 'Africa Food Services' limit 1)
where producer_id is null
  and tenant_id = (select id from tenants where slug = 'chloefood');

update products
set importer_id = (select id from importers where tenant_id = products.tenant_id and name = 'AFRICOOP Società Cooperativa' limit 1)
where importer_id is null
  and tenant_id = (select id from tenants where slug = 'chloefood');
