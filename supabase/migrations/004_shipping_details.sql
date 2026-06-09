alter table orders
  add column if not exists shipping_details jsonb;

comment on column orders.shipping_details is
  'Breakdown spedizione al momento dell''ordine. '
  'Solo uso interno/admin, mai esposto al cliente. '
  'Struttura: { totalWeightG, numParcels, packlinkCost, vatRate, '
  'vatAmount, surchargeMode, packagingSurchargeTotal, '
  'boxDimensions: {length, width, height}, serviceId }';
