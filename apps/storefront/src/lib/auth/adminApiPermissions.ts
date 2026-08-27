export type AdminApiPermission =
  | 'orders.view'
  | 'orders.manage'
  | 'shop_payments.confirm'
  | 'catalog.view'
  | 'catalog.manage'
  | 'shipping.view'
  | 'shipping.manage'
  | 'loyalty.manage'
  | 'loyalty.scan'
  | 'growth.manage'
  | 'growth.payouts.manage'
  | 'ai_knowledge.manage'
  | 'events.view'
  | 'events.manage'
  | 'event_reservations.view'
  | 'event_reservations.manage'
  | 'event_payments.view'
  | 'event_payments.confirm'
  | 'event_payments.cancel'
  | 'event_payments.refund'
  | 'event_content.manage'
  | 'tenant_settings.view'
  | 'tenant_settings.manage';

function isRead(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD';
}

/**
 * Canonical capability map for legacy /api/admin handlers that still call
 * requireAdmin(). The middleware forwards pathname + method through trusted
 * request headers so authorization is decided centrally and custom RBAC roles
 * do not depend on hard-coded role names inside every handler.
 *
 * Keep this map fail-closed: a legacy admin API that is not mapped must not
 * silently fall back to tenant_admin semantics.
 */
export function permissionForAdminApi(pathname: string, method: string): AdminApiPermission | null {
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  const read = isRead(method);

  if (/^\/api\/admin\/checkout-sessions\/[^/]+\/confirm-payment$/.test(path)) return 'shop_payments.confirm';
  if (path.startsWith('/api/admin/checkout-sessions')) return read ? 'orders.view' : 'orders.manage';
  if (path.startsWith('/api/admin/orders')) return read ? 'orders.view' : 'orders.manage';

  if (path.startsWith('/api/admin/catalogue')) return read ? 'catalog.view' : 'catalog.manage';
  if (
    path.startsWith('/api/admin/hero-slides') ||
    path.startsWith('/api/admin/social-links') ||
    path.startsWith('/api/admin/labels') ||
    path === '/api/admin/upload-label-asset' ||
    path === '/api/admin/upload-product-image' ||
    path === '/api/admin/generate-product-image' ||
    path === '/api/admin/generate-product-description'
  ) return 'catalog.manage';

  if (path === '/api/admin/card/poster' || path === '/api/admin/upload-story-photo') return 'tenant_settings.manage';
  if (path.startsWith('/api/admin/knowledge-base')) return 'ai_knowledge.manage';

  if (path.startsWith('/api/admin/loyalty/scan')) return 'loyalty.scan';
  if (path.startsWith('/api/admin/loyalty')) return 'loyalty.manage';

  if (/^\/api\/admin\/ambassador\/commissions\/[^/]+\/pay$/.test(path)) return 'growth.payouts.manage';
  if (path.startsWith('/api/admin/ambassador')) return 'growth.manage';

  if (path.startsWith('/api/admin/shipping-rules')) return read ? 'shipping.view' : 'shipping.manage';
  if (path === '/api/admin/shipping-simulator') return 'shipping.view';

  if (path === '/api/admin/tenant') return read ? 'tenant_settings.view' : 'tenant_settings.manage';
  if (path.startsWith('/api/admin/payment-methods')) return read ? 'tenant_settings.view' : 'tenant_settings.manage';
  if (path.startsWith('/api/admin/notification-recipients')) return read ? 'tenant_settings.view' : 'tenant_settings.manage';

  // Events external payments — keep money-moving actions explicit.
  if (/^\/api\/admin\/evenementiel\/reservation-requests\/[^/]+\/confirm-payment$/.test(path)) return 'event_payments.confirm';
  if (/^\/api\/admin\/evenementiel\/rental-reservation-requests\/[^/]+\/confirm-payment$/.test(path)) return 'event_payments.confirm';
  if (/^\/api\/admin\/evenementiel\/reservation-requests\/[^/]+\/cancel$/.test(path)) return 'event_payments.cancel';
  if (/^\/api\/admin\/evenementiel\/reservations\/[^/]+\/refund$/.test(path)) return 'event_payments.refund';

  if (path.startsWith('/api/admin/evenementiel/reservations')) return read ? 'event_reservations.view' : 'event_reservations.manage';
  if (path.startsWith('/api/admin/evenementiel/rental-reservations')) return read ? 'event_reservations.view' : 'event_reservations.manage';

  if (path.startsWith('/api/admin/evenementiel/events')) return read ? 'events.view' : 'events.manage';
  if (path.startsWith('/api/admin/evenementiel/ticket-types')) return read ? 'events.view' : 'events.manage';
  if (path.startsWith('/api/admin/evenementiel/inquiries')) return read ? 'event_reservations.view' : 'event_reservations.manage';

  // Rental inventory belongs to event content/configuration; rental bookings
  // themselves are handled above through rental-reservations.
  if (
    path.startsWith('/api/admin/evenementiel/rental-items') ||
    path.includes('/rental-items') ||
    path.startsWith('/api/admin/evenementiel/gallery') ||
    path.startsWith('/api/admin/evenementiel/services') ||
    path === '/api/admin/evenementiel/upload-image' ||
    path === '/api/admin/evenementiel/settings'
  ) return 'event_content.manage';

  return null;
}
