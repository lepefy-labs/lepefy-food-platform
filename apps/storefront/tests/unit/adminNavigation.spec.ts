import { test, expect } from '@playwright/test';
import {
  ADMIN_NAV, ADMIN_QUICK_ACTIONS, activeNavChild, visibleNavChildren, isNavItemActive, mobileNavItems, navItemsById, resolveAdminNavigation, type AdminNavContext, ADMIN_NAV_PRIMARY_GROUPS, ADMIN_NAV_GROUPS, isPrimaryNavGroup } from '../../src/lib/admin/navigation';
import { defaultAdminDestination, permissionsForAdminPath } from '../../src/lib/auth/adminRoutePermissions';

const NO_FLAGS = { gestion: false, whatsapp: false, activity: false, support: false };
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
    'today', 'orders', 'catalogue', 'shipping', 'customers',
    'card-payments', 'checkout-funnel', 'loyalty-scan',
    'loyalty', 'ambassadors', 'reviews', 'nala-analytics', 'ai-lab',
    'home-slides', 'public-content', 'tools', 'settings', 'billing', 'ai-usage',
  ]);
  expect(full.actions).toEqual(['new-order', 'prepare-orders', 'new-product', 'new-catalog-campaign', 'new-customer']);
  expect(full.platform).toBe(false);

  const withFlags = resolveAdminNavigation(ctx({ permissions: ['*'], flags: { gestion: true, whatsapp: true, activity: true, support: true } }));
  expect(withFlags.items).toEqual(expect.arrayContaining(['whatsapp', 'gestion', 'suppliers', 'purchases', 'inventory', 'treasury', 'activity', 'assistance']));
  expect(withFlags.actions).toContain('support-request');
});

test('assistance: hidden until the platform enables it, and only with support.use', () => {
  const on = { gestion: false, whatsapp: false, activity: false, support: true };
  expect(resolveAdminNavigation(ctx({ permissions: ['support.use'] })).items).not.toContain('assistance');
  expect(resolveAdminNavigation(ctx({ permissions: ['support.use'] })).actions).not.toContain('support-request');
  expect(resolveAdminNavigation(ctx({ permissions: ['orders.view'], flags: on })).items).not.toContain('assistance');
  const user = resolveAdminNavigation(ctx({ permissions: ['support.use'], flags: on }));
  expect(user.items).toEqual(['assistance']);
  expect(user.actions).toEqual(['support-request']);
  expect(resolveAdminNavigation(ctx({ workspace: 'events', permissions: ['support.use'], flags: on })).items).toEqual(['assistance']);
  expect(permissionsForAdminPath('/admin/assistance/0f8c2b36-5a3d-4c41-9f2e-6c1b8c0a1d11', 'shop')).toEqual(['support.use']);
  // The cashier keeps the scanner only: support.use is not in its default capabilities.
  expect(resolveAdminNavigation(ctx({ permissions: ['loyalty.scan'], flags: on })).items).toEqual(['loyalty-scan']);
});

test('activity journal: hidden until the platform enables it, and only with audit.view', () => {
  expect(resolveAdminNavigation(ctx({ permissions: ['audit.view'] })).items).not.toContain('activity');
  expect(resolveAdminNavigation(ctx({ permissions: ['orders.view'], flags: { gestion: false, whatsapp: false, activity: true, support: false } })).items).not.toContain('activity');
  expect(resolveAdminNavigation(ctx({ permissions: ['audit.view'], flags: { gestion: false, whatsapp: false, activity: true, support: false } })).items).toContain('activity');
});

test('a cashier only sees the loyalty scanner; a stock clerk only sees Stocks', () => {
  expect(resolveAdminNavigation(ctx({ permissions: ['loyalty.scan'] })).items).toEqual(['loyalty-scan']);
  const clerk = resolveAdminNavigation(ctx({ permissions: ['inventory.view'], flags: { gestion: true, whatsapp: false, activity: false, support: false } }));
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
  const owner = resolveAdminNavigation(ctx({ isPlatformOwner: true, flags: { gestion: true, whatsapp: true, activity: true, support: true } }));
  expect(owner.platform).toBe(true);
  expect(owner.items).toContain('treasury');
});

test('active state: exact, prefix and extra paths', () => {
  const byId = (id: string) => ADMIN_NAV.find((item) => item.id === id)!;
  expect(isNavItemActive('/admin', byId('today'))).toBe(true);
  expect(isNavItemActive('/admin/orders', byId('today'))).toBe(false);
  expect(isNavItemActive('/admin', byId('orders'))).toBe(false);
  expect(isNavItemActive('/admin/orders', byId('orders'))).toBe(true);
  expect(isNavItemActive('/admin/orders/123', byId('orders'))).toBe(true);
  expect(isNavItemActive('/admin/orders/preparation', byId('orders'))).toBe(true);
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
  expect(mobileNavItems(full.items).map((item) => item.id)).toEqual(['today', 'orders', 'catalogue']);
  const cashier = resolveAdminNavigation(ctx({ permissions: ['loyalty.scan'] }));
  expect(mobileNavItems(cashier.items).map((item) => item.id)).toEqual(['loyalty-scan']);
  const events = resolveAdminNavigation(ctx({ workspace: 'events', permissions: ['*'] }));
  expect(mobileNavItems(events.items).map((item) => item.id)).toEqual(['events-overview', 'event-reservations', 'event-scan']);
  expect(navItemsById(['shipping', 'orders']).map((item) => item.id)).toEqual(['orders', 'shipping']);
});

test('daily groups stay open, every other module folds without disappearing', () => {
  expect(ADMIN_NAV_PRIMARY_GROUPS).toEqual(['Essentiel', 'Événementiel', 'Service sur place']);
  const shopPrimary = ADMIN_NAV.filter((item) => item.workspace === 'shop' && isPrimaryNavGroup(item.group)).map((item) => item.id);
  expect(shopPrimary).toEqual(['today', 'orders', 'catalogue', 'shipping', 'customers']);
  for (const item of ADMIN_NAV) expect(ADMIN_NAV_GROUPS, item.id).toContain(item.group);
});

test('module sub-pages: same permissions as their entry, inside it, longest match active', () => {
  for (const item of ADMIN_NAV) {
    for (const child of item.children ?? []) {
      expect(isNavItemActive(child.href, item), `${item.id}: ${child.href} is outside the entry`).toBe(true);
      const workspaces = item.workspace === 'all' ? (['shop', 'events'] as const) : [item.workspace];
      for (const workspace of workspaces) {
        const routePermissions = permissionsForAdminPath(child.href, workspace);
        for (const permission of child.anyOf ?? item.anyOf) expect(routePermissions, `${child.href} requires ${routePermissions}`).toContain(permission);
      }
    }
  }
  const children = ADMIN_NAV.find((item) => item.id === 'catalogue')!.children!;
  expect(activeNavChild('/admin/catalogue', children)?.href).toBe('/admin/catalogue');
  expect(activeNavChild('/admin/catalogue/1f2e', children)?.href).toBe('/admin/catalogue');
  expect(activeNavChild('/admin/catalogue/campagnes/x', children)?.href).toBe('/admin/catalogue/campagnes');
  expect(activeNavChild('/admin/catalogue/categories', children)?.href).toBe('/admin/catalogue/categories');
  expect(activeNavChild('/admin/orders', children)).toBeNull();
});

test('sub-pages are resolved per capability: a sub-page with its own capability stays hidden without it', () => {
  const customers = ADMIN_NAV.find((item) => item.id === 'customers')!;
  const viewer = resolveAdminNavigation(ctx({ permissions: ['customers.view'] }));
  expect(visibleNavChildren(customers, viewer.children).map((child) => child.href)).toEqual(['/admin/clients', '/admin/clients/segments']);
  const marketer = resolveAdminNavigation(ctx({ permissions: ['customers.view', 'campaigns.view'] }));
  expect(visibleNavChildren(customers, marketer.children).map((child) => child.href)).toContain('/admin/clients/campagnes');
  // Entries outside the workspace resolve no children.
  expect(resolveAdminNavigation(ctx({ workspace: 'events', permissions: ['*'] })).children.customers).toBeUndefined();
});
