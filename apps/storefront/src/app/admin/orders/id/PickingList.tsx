'use client';

import type { Order, OrderItem } from '@lepefy/types';

interface Props {
  order: Order;
  items: OrderItem[];
  currency: string;
}

// Storage badge config — text only, no colour (prints cleanly on B&W)
const STORAGE_BADGE: Record<string, string> = {
  fresh:  '[ FRESCO ]',
  frozen: '[ SURGELATO ]',
  dry:    '[ SECCO ]',
};

export default function PickingList({ order, items, currency }: Props) {
  const date = new Date(order.created_at).toLocaleDateString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const isPickup = order.fulfillment_type === 'pickup';

  // The items arrive pre-sorted from the server (warehouse_location NULLS LAST).
  // Group by storage_type for a secondary visual separation on the sheet.
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="pl-content" style={{ display: 'none' }}>

        {/* Header */}
        <div className="pl-header">
          <div className="pl-header-top">
            <h1 className="pl-title">PICKING LIST</h1>
            <span className="pl-fulfillment">
              {isPickup ? '🏪 CLICK & COLLECT' : '🚚 SPEDIZIONE'}
            </span>
          </div>

          <div className="pl-order-id-short">
            #{order.id.slice(0, 8).toUpperCase()}
          </div>

          <div className="pl-meta">
            <span><strong>Data:</strong> {date}</span>
            <span><strong>Cliente:</strong> {order.full_name ?? order.email}</span>
            <span><strong>Email:</strong> {order.email}</span>
            {!isPickup && order.shipping_address && (
              <span>
                <strong>Indirizzo:</strong>{' '}
                {(order.shipping_address as { line1?: string }).line1},{' '}
                {(order.shipping_address as { postal_code?: string }).postal_code}{' '}
                {(order.shipping_address as { city?: string }).city}
              </span>
            )}
            <span><strong>Articoli totali:</strong> {totalQty} pz ({items.length} referenze)</span>
          </div>
        </div>

        <hr className="pl-divider" />

        {/* Items table */}
        <table className="pl-table">
          <thead>
            <tr>
              <th className="pl-th pl-th-check">✓</th>
              <th className="pl-th pl-th-qty">QTÀ</th>
              <th className="pl-th pl-th-name">PRODOTTO</th>
              <th className="pl-th pl-th-loc">UBICAZIONE</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id} className={idx % 2 === 0 ? 'pl-row-even' : 'pl-row-odd'}>

                {/* Checkbox */}
                <td className="pl-td pl-td-check">
                  <span className="pl-checkbox">□</span>
                </td>

                {/* Quantity — large + bold */}
                <td className="pl-td pl-td-qty">
                  <span className="pl-qty">{item.quantity}</span>
                  <span className="pl-qty-unit">pz</span>
                </td>

                {/* Product name + alt name + storage badge */}
                <td className="pl-td pl-td-name">
                  <span className="pl-name">{item.name}</span>
                  {item.name_alt && (
                    <span className="pl-name-alt">↳ {item.name_alt}</span>
                  )}
                  {item.storage_type && item.storage_type !== 'dry' && (
                    <span className="pl-storage-badge">
                      {STORAGE_BADGE[item.storage_type] ?? ''}
                    </span>
                  )}
                </td>

                {/* Warehouse location */}
                <td className="pl-td pl-td-loc">
                  {item.warehouse_location
                    ? <span className="pl-location">{item.warehouse_location}</span>
                    : <span className="pl-location-empty">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Footer */}
        <div className="pl-footer">
          <span>Preparato da: ___________________</span>
          <span>Controllato da: ___________________</span>
          <span>Ora: ___________</span>
        </div>
    </div>
  );
}
