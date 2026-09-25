export type AdminApiPermission =
  | 'orders.view' | 'orders.manage' | 'shop_payments.confirm'
  | 'catalog.view' | 'catalog.manage'
  | 'customers.view' | 'customers.manage' | 'segments.manage' | 'campaigns.view' | 'campaigns.manage'
  | 'reviews.view' | 'reviews.moderate' | 'reviews.manage'
  | 'shipping.view' | 'shipping.manage'
  | 'loyalty.manage' | 'loyalty.scan'
  | 'growth.manage' | 'growth.payouts.manage' | 'ai_knowledge.manage'
  | 'events.view' | 'events.manage' | 'event_capacity.manage'
  | 'event_reservations.view' | 'event_reservations.manage'
  | 'event_payments.view' | 'event_payments.confirm' | 'event_payments.cancel' | 'event_payments.refund'
  | 'event_content.manage' | 'tenant_settings.view' | 'tenant_settings.manage';

function isRead(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD';
}

export function permissionForAdminApi(pathname: string, method: string): AdminApiPermission | null {
  const rawPath = pathname.split('?')[0] ?? pathname;
  const path = rawPath.replace(/\/+$/, '') || '/';
  const read = isRead(method);

  if (/^\/api\/admin\/checkout-sessions\/[^/]+\/confirm-payment$/.test(path)) return 'shop_payments.confirm';
  // Commandes assistées : enregistrer un encaissement (« Déjà payé ») ou
  // confirmer un paiement déclaré crée une commande payée → capability critique.
  if (path === '/api/admin/assisted-orders/paid') return method.toUpperCase() === 'POST' ? 'shop_payments.confirm' : null;
  if (/^\/api\/admin\/assisted-orders\/[^/]+\/confirm-payment$/.test(path)) return method.toUpperCase() === 'POST' ? 'shop_payments.confirm' : null;
  // Recherche client / catalogue réservée à la saisie (données de contact).
  if (path.startsWith('/api/admin/assisted-orders/customers') || path === '/api/admin/assisted-orders/products') return 'orders.manage';
  if (path.startsWith('/api/admin/assisted-orders')) return read ? 'orders.view' : 'orders.manage';
  if (path.startsWith('/api/admin/checkout-sessions')) return read ? 'orders.view' : 'orders.manage';
  if (/^\/api\/admin\/orders\/[^/]+\/shipment\/(attach|sync|manual)$/.test(path)) return method.toUpperCase() === 'POST' ? 'orders.manage' : null;
  if (path.startsWith('/api/admin/orders')) return read ? 'orders.view' : 'orders.manage';
  if (path === '/api/admin/reviews/settings') return read ? 'reviews.view' : 'reviews.manage';
  if (/^\/api\/admin\/reviews\/[^/]+$/.test(path)) return read ? 'reviews.view' : 'reviews.moderate';
  if (path.startsWith('/api/admin/reviews')) return read ? 'reviews.view' : 'reviews.manage';
  if (path.startsWith('/api/admin/catalogue')) return read ? 'catalog.view' : 'catalog.manage';
  if (path.startsWith('/api/admin/clients/segments')) return 'segments.manage';
  if (path.startsWith('/api/admin/clients/campaigns')) return read ? 'campaigns.view' : 'campaigns.manage';
  if (path === '/api/admin/clients/export' || path === '/api/admin/clients') return read ? 'customers.view' : 'customers.manage';
  if (path.startsWith('/api/admin/clients/')) return read ? 'customers.view' : 'customers.manage';
  if (path.startsWith('/api/admin/hero-slides') || path.startsWith('/api/admin/social-links') || path.startsWith('/api/admin/labels') || path === '/api/admin/upload-label-asset' || path === '/api/admin/upload-product-image' || path === '/api/admin/generate-product-image' || path === '/api/admin/generate-product-description') return 'catalog.manage';
  if (path === '/api/admin/card/poster' || path === '/api/admin/upload-story-photo' || path === '/api/admin/app-icon') return 'tenant_settings.manage';
  if (path.startsWith('/api/admin/knowledge-base')) return 'ai_knowledge.manage';
  if (path.startsWith('/api/admin/loyalty/scan')) return 'loyalty.scan';
  if (path.startsWith('/api/admin/loyalty')) return 'loyalty.manage';
  if (/^\/api\/admin\/ambassador\/commissions\/[^/]+\/pay$/.test(path)) return 'growth.payouts.manage';
  if (path.startsWith('/api/admin/ambassador')) return 'growth.manage';
  if (path.startsWith('/api/admin/shipping-rules')) return read ? 'shipping.view' : 'shipping.manage';
  if (path === '/api/admin/shipping-simulator' || path === '/api/admin/packlink-inspector') return 'shipping.view';
  if (path.startsWith('/api/admin/shipping-packaging-profiles')) return read ? 'shipping.view' : 'shipping.manage';
  if (path.startsWith('/api/admin/shipping-zones')) return read ? 'shipping.view' : 'shipping.manage';
  if (/^\/api\/admin\/shipping-simulation-campaigns\/[^/]+\/cancel$/.test(path)) return method.toUpperCase() === 'POST' ? 'shipping.manage' : null;
  if (path.startsWith('/api/admin/shipping-simulation-campaigns')) return read ? 'shipping.view' : 'shipping.manage';
  if (path.startsWith('/api/admin/shipping-observations')) return 'shipping.view';
  if (path === '/api/admin/shipping-advisor') return 'shipping.view';
  if (/^\/api\/admin\/shipping-tariff-drafts\/[^/]+\/simulate$/.test(path)) return method.toUpperCase() === 'POST' ? 'shipping.view' : null;
  if (path.startsWith('/api/admin/shipping-tariff-drafts')) return read ? 'shipping.view' : 'shipping.manage';
  if (/^\/api\/admin\/shipping-tariff-versions\/[^/]+\/select$/.test(path)) return method.toUpperCase() === 'POST' ? 'shipping.manage' : null;
  if (/^\/api\/admin\/shipping-tariff-versions\/[^/]+\/activate$/.test(path)) return method.toUpperCase() === 'POST' ? 'shipping.manage' : null;
  if (path === '/api/admin/shipping-tariff-versions/retire') return method.toUpperCase() === 'POST' ? 'shipping.manage' : null;
  if (path === '/api/admin/shipping-tariff-versions') return read ? 'shipping.view' : 'shipping.manage';
  if (path === '/api/admin/shipping-pricing-mode') return read ? 'shipping.view' : 'shipping.manage';
  if (path === '/api/admin/shipping-shadow-report') return read ? 'shipping.view' : null;
  if (path === '/api/admin/shipping-postal-code-import') return 'shipping.manage';
  if (path === '/api/admin/tenant') return read ? 'tenant_settings.view' : 'tenant_settings.manage';
  if (path.startsWith('/api/admin/payment-methods') || path.startsWith('/api/admin/notification-recipients')) return read ? 'tenant_settings.view' : 'tenant_settings.manage';

  if (/^\/api\/admin\/evenementiel\/reservation-requests\/[^/]+\/confirm-payment$/.test(path)) return 'event_payments.confirm';
  if (/^\/api\/admin\/evenementiel\/rental-reservation-requests\/[^/]+\/confirm-payment$/.test(path)) return 'event_payments.confirm';
  if (path === '/api/admin/evenementiel/reservations/manual') return 'event_payments.confirm';
  if (/^\/api\/admin\/evenementiel\/reservation-requests\/[^/]+\/cancel$/.test(path)) return 'event_payments.cancel';
  if (/^\/api\/admin\/evenementiel\/reservations\/[^/]+\/refund$/.test(path)) return 'event_payments.refund';
  if (/^\/api\/admin\/evenementiel\/events\/[^/]+\/capacity$/.test(path)) return 'event_capacity.manage';
  if (path.startsWith('/api/admin/evenementiel/reservations') || path.startsWith('/api/admin/evenementiel/rental-reservations')) return read ? 'event_reservations.view' : 'event_reservations.manage';
  if (path.startsWith('/api/admin/evenementiel/events') || path.startsWith('/api/admin/evenementiel/ticket-types')) return read ? 'events.view' : 'events.manage';
  if (path.startsWith('/api/admin/evenementiel/inquiries')) return read ? 'event_reservations.view' : 'event_reservations.manage';
  if (path.startsWith('/api/admin/evenementiel/rental-items') || path.includes('/rental-items') || path.startsWith('/api/admin/evenementiel/gallery') || path.startsWith('/api/admin/evenementiel/services') || path === '/api/admin/evenementiel/upload-image' || path === '/api/admin/evenementiel/settings') return 'event_content.manage';
  if (path.startsWith('/api/admin/evenementiel/rental-delivery-zones')) return 'event_content.manage';
  return null;
}
