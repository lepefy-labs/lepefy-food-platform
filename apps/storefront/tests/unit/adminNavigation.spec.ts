import { test, expect } from '@playwright/test';
import {
  ADMIN_NAV, ADMIN_QUICK_ACTIONS, isNavItemActive, mobileNavItems, navItemsById, resolveAdminNavigation, type AdminNavContext,
} from '../../src/lib/admin/navigation';
import { defaultAdminDestination, permissionsForAdminPath } from '../../src/lib/auth/adminRoutePermissions';

const NO_FLAGS = { gestion: false, whatsapp: false };
const ctx = (patch: Partial<AdminNavContext>): AdminNavContext => ({ workspace: 'shop', permissions: [], isPlatformOwner: false, flags: NO_FLAGS, ...patch });

test('entry ids are unique', () => {
  const ids = [...ADMIN_NAV.map((item) => item.id), ...ADMIN_QUICK_ACTIONS.map((action) => action.id)];
  expect(new Set(ids).size).toBe(ids.length);
});

test('every capability that shows an entry also opens its page (nav never links to a redirect)', () => {
  for (const item of ADMIN_NAV.filter((entry) => entry.href.startsWith('/admin'))) {
    const workspaces = item.workspace === 'all' ? (['shop', 'events'] as const) : [item.workspace];
    for (const workspace of workspaces) {
      const routePermissions = permissionsForAdminPath(item.href, workspace);
      expect(routePermissions, `${item.id} ${item.href} is not mapped in adminRoutePermissions`).not.toBeNull();
      for (const permission of item.anyOf) {
        expect(routePermissions, `${item.id}: ${permission} shows the entry but ${item.href} requires ${routePermissions}`).toContain(permission);
      }
    }
  }
  for (const action of ADMIN_QUICK_ACTIONS) {
    expect(permissionsForAdminPath(action.href.split('?')[0] ?? action.href, 'shop'), action.id).not.toBeNull();
  }
});

test('route prefixes match whole path segments', () => {
  expect(permissionsForAdminPath('/admin/evenementiel/reservations', 'events')).toEqual(['event_reservations.view']);
  expect(permissionsForAdminPath('/admin/evenementiel/reservations/abc', 'events')).toEqual(['event_reservations.view']);
  // Locations has its own rule (rental reservations: customer data, same capability as its APIs).
  expect(permissionsForAdminPath('/admin/evenementiel/reservations-materiel', 'events')).toEqual(['event_reservations.view']);
  // Demandes traiteur: customer data, same capability as /api/admin/evenementiel/inquiries.
  expect(permissionsForAdminPath('/admin/evenementiel/devis', 'events')).toEqual(['event_reservations.view']);
  expect(permissionsForAdminPath('/admin/evenementiel/livraison-materiel', 'events')).toEqual(['event_content.manage']);
  expect(permissionsForAdminPath('/admin/cataloguex', 'shop')).toBeNull();
});

const SINGLE_PERMISSIONS = [...new Set([
  ...ADMIN_NAV.flatMap((item) => item.anyOf),
  'orders.view', 'catalog.view', 'customers.view', 'reviews.view', 'loyalty.scan', 'shipping.view', 'billing.view', 'ai_usage.view',
  'events.view', 'event_reservations.view', 'event_payments.view', 'event_content.manage', 'scan.access', 'platform.access',
])];

test('the default destination always opens for the same permissions (no redirect loop)', () => {
  for (const workspace of ['shop', 'events'] as const) {
    for (const permission of SINGLE_PERMISSIONS) {
      const destination = defaultAdminDestination([permission], workspace);
      if (!destination || !destination.startsWith('/admin')) continue;
      const required = permissionsForAdminPath(destination, workspace);
      expect(required?.includes(permission), `${workspace} ${permission} -> ${destination} requires ${required}`).toBe(true);
    }
  }
  // Payments-only role: no page opens with event_payments.view alone, so no admin landing page.
  expect(defaultAdminDestination(['event_payments.view'], 'events')).toBeNull();
  expect(defaultAdminDestination(['event_payments.view', 'scan.access'], 'events')).toBe('/scan');
  expect(defaultAdminDestination(['event_reservations.view'], 'events')).toBe('/admin/evenementiel/reservations');
  expect(defaultAdminDestination(['events.view'], 'events')).toBe('/admin');
  expect(defaultAdminDestination(['catalog.view'], 'shop')).toBe('/admin/catalogue');
  expect(defaultAdminDestination(['*'], 'shop')).toBe('/admin');
  expect(defaultAdminDestination(['platform.access'], 'shop')).toBe('/admin/platform');
});

test('full shop admin sees the shop and common entries, flagged modules only with their flag', () => {
  const full = resolveAdminNavigation(ctx({ permissions: ['*'] }));
  expect(full.items).toEqual([
    'orders', 'card-payments', 'checkout-funnel', 'catalogue', 'customers', 'home-slides',
    'loyalty-scan', 'shipping',
    'loyalty', 'ambassadors', 'reviews', 'nala-analytics', 'ai-lab',
    'public-content', 'tools', 'settings', 'billing', 'ai-usage',
  ]);
  expect(full.actions).toEqual(['new-order', 'new-product', 'new-customer']);
  expect(full.platform).toBe(false);

  const withFlags = resolveAdminNavigation(ctx({ permissions: ['*'], flags: { gestion: true, whatsapp: true } }));
  expect(withFlags.items).toEqual(expect.arrayContaining(['whatsapp', 'gestion', 'suppliers', 'purchases', 'inventory', 'treasury']));
});

test('a cashier only sees the loyalty scanner; a stock clerk only sees Stocks', () => {
  expect(resolveAdminNavigation(ctx({ permissions: ['loyalty.scan'] })).items).toEqual(['loyalty-scan']);
  const clerk = resolveAdminNavigation(ctx({ permissions: ['inventory.view'], flags: { gestion: true, whatsapp: false } }));
  expect(clerk.items).toEqual(['gestion', 'inventory']);
});

test('events workspace shows events entries, never shop ones', () => {
  const events = resolveAdminNavigation(ctx({ workspace: 'events', permissions: ['*'] }));
  expect(events.items).toEqual([
    'events-overview', 'events', 'event-reservations', 'catering-requests', 'rentals', 'event-content', 'rental-delivery', 'event-scan',
    'public-content', 'tools', 'settings', 'billing', 'ai-usage',
  ]);
  expect(events.actions).toEqual([]);
});

test('platform owner sees everything of the workspace plus the platform block', () => {
  const owner = resolveAdminNavigation(ctx({ isPlatformOwner: true, flags: { gestion: true, whatsapp: true } }));
  expect(owner.platform).toBe(true);
  expect(owner.items).toContain('treasury');
});

test('active state: exact, prefix and extra paths', () => {
  const byId = (id: string) => ADMIN_NAV.find((item) => item.id === id)!;
  expect(isNavItemActive('/admin', byId('orders'))).toBe(true);
  expect(isNavItemActive('/admin/orders/123', byId('orders'))).toBe(true);
  expect(isNavItemActive('/admin/paiements-en-attente/abc', byId('orders'))).toBe(true);
  expect(isNavItemActive('/admin/catalogue', byId('orders'))).toBe(false);
  expect(isNavItemActive('/admin/catalogue/abc', byId('catalogue'))).toBe(true);
  expect(isNavItemActive('/admin/loyalty/scan', byId('loyalty'))).toBe(false);
  expect(isNavItemActive('/admin/loyalty/scan', byId('loyalty-scan'))).toBe(true);
  expect(isNavItemActive('/admin/evenementiel', byId('events-overview'))).toBe(true);
  expect(isNavItemActive('/admin/evenementiel/galerie/x', byId('event-content'))).toBe(true);
});

test('mobile bar: at most three visible entries in their declared order', () => {
  const full = resolveAdminNavigation(ctx({ permissions: ['*'] }));
  expect(mobileNavItems(full.items).map((item) => item.id)).toEqual(['orders', 'catalogue', 'loyalty-scan']);
  const cashier = resolveAdminNavigation(ctx({ permissions: ['loyalty.scan'] }));
  expect(mobileNavItems(cashier.items).map((item) => item.id)).toEqual(['loyalty-scan']);
  const events = resolveAdminNavigation(ctx({ workspace: 'events', permissions: ['*'] }));
  expect(mobileNavItems(events.items).map((item) => item.id)).toEqual(['events-overview', 'event-reservations', 'event-scan']);
  expect(navItemsById(['shipping', 'orders']).map((item) => item.id)).toEqual(['orders', 'shipping']);
});
