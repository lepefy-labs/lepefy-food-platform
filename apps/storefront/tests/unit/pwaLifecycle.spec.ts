import { test, expect } from '@playwright/test';
import { acquireBusy, isBusy, resetBusyRegistry, subscribeBusyRelease } from '../../src/lib/pwa/busyRegistry';
import {
  CHUNK_ERROR_PATTERN,
  DATA_STALE_AFTER_MS,
  RELEASE_SETTLE_MS,
  RELOAD_GUARD_TTL_MS,
  SESSION_STALE_AFTER_MS,
  VERSION_CHECK_MIN_INTERVAL_MS,
  classifyAbsence,
  createLifecycleController,
  isCriticalRoute,
  isReloadBlocked,
  scopeForPath,
  versionsDiffer,
  type LifecycleDeps,
  type MinimalStorage,
} from '../../src/lib/pwa/lifecycle';

function memoryStorage(): MinimalStorage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
}

function harness(overrides: Partial<LifecycleDeps> & { remote?: string | null } = {}) {
  let clock = 1_000_000;
  const log = { reload: 0, refresh: 0, sw: 0, session: 0, fetches: 0, flush: 0, banner: [] as boolean[] };
  const scheduled: Array<() => void> = [];
  const deps: LifecycleDeps = {
    now: () => clock,
    currentVersion: 'aaa',
    storage: memoryStorage(),
    isOnline: () => true,
    pathname: () => '/',
    isBusy: () => isBusy(),
    hasEditableForm: () => false,
    hasPendingCartMutations: () => false,
    fetchRemoteVersion: async () => { log.fetches++; return overrides.remote === undefined ? 'aaa' : overrides.remote; },
    updateServiceWorker: async () => { log.sw++; },
    refreshData: () => { log.refresh++; },
    revalidateSession: async () => { log.session++; },
    flushCart: async () => { log.flush++; },
    reload: () => { log.reload++; },
    schedule: (fn) => { scheduled.push(fn); return () => {}; },
    onUpdateAvailable: (v) => { log.banner.push(v); },
    ...overrides,
  };
  const controller = createLifecycleController(deps);
  return {
    controller, deps, log, scheduled,
    advance(ms: number) { clock += ms; },
    background(ms: number) { controller.onHidden(); clock += ms; },
  };
}

test.beforeEach(() => resetBusyRegistry());

test.describe('pure rules', () => {
  test('absence tiers', () => {
    expect(classifyAbsence(5_000)).toBe('none');
    expect(classifyAbsence(60_000)).toBe('check');
    expect(classifyAbsence(DATA_STALE_AFTER_MS + 1)).toBe('data');
    expect(classifyAbsence(SESSION_STALE_AFTER_MS + 1)).toBe('session');
  });
  test('versions only differ when both are known', () => {
    expect(versionsDiffer('a', 'b')).toBe(true);
    expect(versionsDiffer('a', 'a')).toBe(false);
    expect(versionsDiffer('', 'b')).toBe(false);
    expect(versionsDiffer('a', null)).toBe(false);
  });
  test('storefront and admin scopes are separate; checkout routes are critical', () => {
    expect(scopeForPath('/admin')).toBe('admin');
    expect(scopeForPath('/admin/orders')).toBe('admin');
    expect(scopeForPath('/administrator')).toBe('storefront');
    expect(scopeForPath('/cart')).toBe('storefront');
    for (const p of ['/checkout', '/checkout/reprendre/x', '/pay/tok', '/order-confirmation']) expect(isCriticalRoute(p)).toBe(true);
    expect(isCriticalRoute('/cart')).toBe(false);
    expect(isCriticalRoute('/checkoutish')).toBe(false);
  });
  test('chunk error detection', () => {
    expect(CHUNK_ERROR_PATTERN.test('ChunkLoadError: Loading chunk 12 failed')).toBe(true);
    expect(CHUNK_ERROR_PATTERN.test('TypeError: x is undefined')).toBe(false);
  });
  test('reload guard fails closed without storage', () => {
    expect(isReloadBlocked(null, 'b', 0)).toBe(true);
  });
});

test.describe('registry', () => {
  test('lock acquire/release is idempotent and notifies', () => {
    let released = 0;
    const off = subscribeBusyRelease(() => { released++; });
    const release = acquireBusy('x');
    expect(isBusy()).toBe(true);
    release(); release();
    expect(isBusy()).toBe(false);
    expect(released).toBe(1);
    off();
  });
});

test.describe('controller', () => {
  test('1. no update available: version checked, nothing reloaded', async () => {
    const h = harness({ remote: 'aaa' });
    await h.controller.onResume('start');
    expect(h.log.fetches).toBe(1);
    expect(h.log.reload).toBe(0);
    expect(h.log.banner).toEqual([]);
  });

  test('2. new version available and safe: one reload', async () => {
    const h = harness({ remote: 'bbb' });
    await h.controller.onResume('start');
    expect(h.log.reload).toBe(1);
  });

  test('3. background for a few seconds: no request, no refresh', async () => {
    const h = harness({ remote: 'bbb' });
    h.background(5_000);
    await h.controller.onResume('visible');
    expect(h.log.fetches).toBe(0);
    expect(h.log.sw).toBe(0);
    expect(h.log.refresh).toBe(0);
  });

  test('3b. visibilitychange + pageshow + focus together act once', async () => {
    const h = harness();
    h.background(60_000);
    await Promise.all([h.controller.onResume('visible'), h.controller.onResume('pageshow'), h.controller.onResume('focus')]);
    expect(h.log.fetches).toBe(1);
    expect(h.log.sw).toBe(1);
  });

  test('4. background for hours: sw + version + data refresh + session revalidation', async () => {
    const h = harness();
    h.background(SESSION_STALE_AFTER_MS + 1);
    await h.controller.onResume('visible');
    expect(h.log.sw).toBe(1);
    expect(h.log.fetches).toBe(1);
    expect(h.log.refresh).toBe(1);
    expect(h.log.session).toBe(1);
  });

  test('4b. medium absence refreshes data but not the session; short check does not refresh data', async () => {
    const h = harness();
    h.background(DATA_STALE_AFTER_MS + 1);
    await h.controller.onResume('visible');
    expect(h.log.refresh).toBe(1);
    expect(h.log.session).toBe(0);
    h.advance(VERSION_CHECK_MIN_INTERVAL_MS + 1);
    h.background(60_000);
    await h.controller.onResume('visible');
    expect(h.log.refresh).toBe(1);
  });

  test('5. active checkout (lock): reload deferred, banner shown, applied after release', async () => {
    const h = harness({ remote: 'bbb' });
    const release = acquireBusy('checkout');
    await h.controller.onResume('start');
    expect(h.log.reload).toBe(0);
    expect(h.log.banner).toEqual([true]);
    release();
    h.controller.onLockReleased();
    expect(h.scheduled.length).toBe(1);
    h.scheduled[0]?.();
    expect(h.log.reload).toBe(1);
    expect(RELEASE_SETTLE_MS).toBeGreaterThan(0);
  });

  test('5b. critical route is never reloaded even without a lock', async () => {
    const h = harness({ remote: 'bbb', pathname: () => '/checkout' });
    await h.controller.onResume('start');
    expect(h.log.reload).toBe(0);
    expect(h.log.banner).toEqual([true]);
  });

  test('6. admin form with unsaved changes or an editable form: banner only', async () => {
    const dirty = harness({ remote: 'bbb', pathname: () => '/admin/catalogue/1' });
    acquireBusy('unsaved-changes');
    await dirty.controller.onResume('start');
    expect(dirty.log.reload).toBe(0);
    resetBusyRegistry();
    const form = harness({ remote: 'bbb', pathname: () => '/admin/catalogue/1', hasEditableForm: () => true });
    await form.controller.onResume('start');
    expect(form.log.reload).toBe(0);
    expect(form.log.banner).toEqual([true]);
  });

  test('6b. same editable form on the storefront does not block (only a real lock does)', async () => {
    const h = harness({ remote: 'bbb', pathname: () => '/cart', hasEditableForm: () => true });
    await h.controller.onResume('start');
    expect(h.log.reload).toBe(1);
  });

  test('7. cart with unsynced mutations is not reloaded; user action flushes first', async () => {
    const h = harness({ remote: 'bbb', hasPendingCartMutations: () => true });
    await h.controller.onResume('start');
    expect(h.log.reload).toBe(0);
    await h.controller.applyNow();
    expect(h.log.flush).toBe(1);
    expect(h.log.reload).toBe(1);
  });

  test('8. expired session: only a definite answer is acted on (long absence triggers revalidation)', async () => {
    const h = harness();
    h.background(SESSION_STALE_AFTER_MS + 1);
    await h.controller.onResume('visible');
    expect(h.log.session).toBe(1);
  });

  test('9/10. offline: no request; replayed once when back online', async () => {
    let online = false;
    const h = harness({ remote: 'bbb', isOnline: () => online });
    h.background(DATA_STALE_AFTER_MS + 1);
    await h.controller.onResume('visible');
    expect(h.log.fetches).toBe(0);
    expect(h.log.refresh).toBe(0);
    online = true;
    h.advance(2_000);
    await h.controller.onResume('online');
    expect(h.log.fetches).toBe(1);
    expect(h.log.refresh).toBe(1);
    expect(h.log.reload).toBe(1);
  });

  test('9b. network error on the version check is silent and throttled', async () => {
    const h = harness({ remote: null });
    await h.controller.onResume('start');
    h.advance(2_000);
    h.background(60_000);
    await h.controller.onResume('visible');
    expect(h.log.fetches).toBe(1); // within the throttle window: no retry storm
    expect(h.log.reload).toBe(0);
    expect(h.log.banner).toEqual([]);
  });

  test('11. obsolete service worker is updated on resume, independent of the UI', async () => {
    const h = harness();
    h.background(60_000);
    await h.controller.onResume('visible');
    expect(h.log.sw).toBe(1);
    expect(h.log.refresh).toBe(0);
  });

  test('12. no reload loop: same target is auto-reloaded once per window', async () => {
    const storage = memoryStorage();
    const first = harness({ remote: 'bbb', storage });
    await first.controller.onResume('start');
    expect(first.log.reload).toBe(1);
    // The page "reloaded" but is still served an old bundle (version unchanged).
    const second = harness({ remote: 'bbb', storage });
    await second.controller.onResume('start');
    expect(second.log.reload).toBe(0);
    expect(second.log.banner).toEqual([true]);
    expect(RELOAD_GUARD_TTL_MS).toBeGreaterThan(0);
  });

  test('12b. chunk error: reloads once when safe, never when busy, never twice', async () => {
    const storage = memoryStorage();
    const h = harness({ storage });
    h.controller.onChunkError();
    expect(h.log.reload).toBe(1);
    const again = harness({ storage });
    again.controller.onChunkError();
    expect(again.log.reload).toBe(0);
    resetBusyRegistry();
    const busy = harness();
    acquireBusy('payment-form');
    busy.controller.onChunkError();
    expect(busy.log.reload).toBe(0);
  });

  test('13. checks never write: no mutation, no flush, no cart or order call', async () => {
    const h = harness({ remote: 'bbb' });
    acquireBusy('x');
    await h.controller.onResume('start');
    h.background(SESSION_STALE_AFTER_MS + 1);
    await h.controller.onResume('visible');
    expect(h.log.flush).toBe(0);
  });

  test('14. admin does not revalidate the storefront session; storefront does', async () => {
    const admin = harness({ pathname: () => '/admin' });
    admin.background(SESSION_STALE_AFTER_MS + 1);
    await admin.controller.onResume('visible');
    expect(admin.log.session).toBe(0);
    expect(admin.log.refresh).toBe(1); // layout re-checks the admin session on refresh
  });

  test('inert without a bundle version (local dev)', async () => {
    const h = harness({ currentVersion: '', remote: 'bbb' });
    await h.controller.onResume('start');
    expect(h.log.fetches).toBe(0);
    expect(h.log.reload).toBe(0);
  });

  test('busy during a data refresh postpones it to the next resume', async () => {
    const h = harness();
    const release = acquireBusy('write-in-flight');
    h.background(DATA_STALE_AFTER_MS + 1);
    await h.controller.onResume('visible');
    expect(h.log.refresh).toBe(0);
    release();
    h.advance(VERSION_CHECK_MIN_INTERVAL_MS + 1);
    h.background(60_000);
    await h.controller.onResume('visible');
    expect(h.log.refresh).toBe(1);
  });
});
