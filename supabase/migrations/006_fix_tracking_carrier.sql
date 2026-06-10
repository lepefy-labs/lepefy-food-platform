-- Rimuove il default 'poste_italiane' hardcodato.
-- tracking_carrier rimane NULL fino alla spedizione fisica.
-- Il corriere scelto da Packlink è in orders.shipping_details.carrierName.
alter table orders
  alter column tracking_carrier drop default;

-- Azzera i valori impostati automaticamente (non dalla cliente)
update orders
set tracking_carrier = null
where tracking_carrier = 'poste_italiane'
  and tracking_code is null
  and tenant_id = (select id from tenants where slug = 'chloefood');
