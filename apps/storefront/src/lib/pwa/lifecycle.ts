// Smart refresh controller for the installed PWAs (storefront and Lepefy Admin).
// Pure: every browser/Next dependency is injected, so the rules are unit-tested
// (tests/unit/pwaLifecycle.spec.ts). Four levels are kept apart:
//   1. service worker update  (deps.updateServiceWorker)
//   2. app version check      (deps.fetchRemoteVersion → compare with the build)
//   3. data refresh           (deps.refreshData = router.refresh, no full reload)
//   4. full reload            (deps.reload, only when safe, at most once per target)
// Docs: docs/PWA_LIFECYCLE.md

export const SHORT_ABSENCE_MS = 30_000;          // below: nothing at all
export const DATA_STALE_AFTER_MS = 30 * 60_000;  // above: refresh server data
export const SESSION_STALE_AFTER_MS = 6 * 3_600_000; // above: revalidate the session
export const VERSION_CHECK_MIN_INTERVAL_MS = 5 * 60_000;
export const RESUME_DEDUPE_MS = 1_000;           // visibilitychange + pageshow + focus fire together
export const RELOAD_GUARD_TTL_MS = 30 * 60_000;  // same target is never auto-reloaded twice in this window
export const RELEASE_SETTLE_MS = 2_000;          // wait after a lock release before an automatic reload

export type PwaScope = 'admin' | 'storefront';
export type ResumeSource = 'start' | 'visible' | 'pageshow' | 'focus' | 'online';
export type AbsenceTier = 'none' | 'check' | 'data' | 'session';

export const CHUNK_ERROR_TARGET = 'chunk-error';

export function scopeForPath(pathname: string): PwaScope {
  return pathname === '/admin' || pathname.startsWith('/admin/') ? 'admin' : 'storefront';
}

// Routes where a reload can destroy payment or order state. Applied in addition
// to (never instead of) the real busy locks.
const CRITICAL_ROUTE = /^\/(checkout|pay|order-confirmation|panier\/retrouver)(\/|$)/;
export function isCriticalRoute(pathname: string): boolean {
  return CRITICAL_ROUTE.test(pathname);
}

export function classifyAbsence(ms: number): AbsenceTier {
  if (ms < SHORT_ABSENCE_MS) return 'none';
  if (ms < DATA_STALE_AFTER_MS) return 'check';
  if (ms < SESSION_STALE_AFTER_MS) return 'data';
  return 'session';
}

const TIER_ORDER: AbsenceTier[] = ['none', 'check', 'data', 'session'];
function maxTier(a: AbsenceTier, b: AbsenceTier): AbsenceTier {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}

/** Only a build version and a deployed version that are both known and different count. */
export function versionsDiffer(current: string | null | undefined, remote: string | null | undefined): boolean {
  return Boolean(current) && Boolean(remote) && current !== remote;
}

// ─── Reload guard (anti-loop) ───────────────────────────────────────────────
export const RELOAD_GUARD_KEY = 'lepefy:pwa-reload';

export interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isReloadBlocked(storage: MinimalStorage | null, target: string, now: number): boolean {
  if (!storage) return true; // storage unavailable: never risk a loop
  try {
    const raw = storage.getItem(RELOAD_GUARD_KEY);
    if (!raw) return false;
    const guard = JSON.parse(raw) as { target?: string; at?: number };
    return guard.target === target && typeof guard.at === 'number' && now - guard.at < RELOAD_GUARD_TTL_MS;
  } catch {
    return true;
  }
}

export function recordReload(storage: MinimalStorage | null, target: string, now: number): boolean {
  if (!storage) return false;
  try {
    storage.setItem(RELOAD_GUARD_KEY, JSON.stringify({ target, at: now }));
    return true;
  } catch {
    return false;
  }
}

// ─── Controller ─────────────────────────────────────────────────────────────
export interface LifecycleDeps {
  now(): number;
  /** Version baked into this bundle at build time; empty = system inert. */
  currentVersion: string;
  storage: MinimalStorage | null;
  isOnline(): boolean;
  pathname(): string;
  /** Registry locks + touched forms + in-flight writes. */
  isBusy(): boolean;
  /** Admin only: an editable form is mounted on the page. */
  hasEditableForm(): boolean;
  hasPendingCartMutations(): boolean;
  /** Resolves null on any network/HTTP error (never throws). */
  fetchRemoteVersion(): Promise<string | null>;
  updateServiceWorker(): Promise<void>;
  /** router.refresh(): re-reads server components, keeps client state. */
  refreshData(): void;
  revalidateSession(): Promise<void>;
  /** Flush the cart queue before leaving; must not throw. */
  flushCart(): Promise<void>;
  reload(): void;
  /** Schedules a callback (setTimeout); returns a canceller. */
  schedule(fn: () => void, ms: number): () => void;
  onUpdateAvailable(available: boolean): void;
}

export interface LifecycleController {
  onHidden(): void;
  onResume(source: ResumeSource): Promise<void>;
  onChunkError(): void;
  onLockReleased(): void;
  /** User tapped "Mettre à jour". */
  applyNow(): Promise<void>;
  state(): { pendingTarget: string | null; lastCheckAt: number };
}

export function createLifecycleController(deps: LifecycleDeps): LifecycleController {
  let hiddenAt: number | null = null;
  let lastResumeAt = -Infinity;
  let lastCheckAt = -Infinity;
  let checking = false;
  let pendingTarget: string | null = null;
  let carriedTier: AbsenceTier = 'none'; // work postponed while offline / busy
  let cancelSettle: (() => void) | null = null;

  function isSafe(): boolean {
    const path = deps.pathname();
    if (deps.isBusy() || isCriticalRoute(path) || deps.hasPendingCartMutations()) return false;
    if (scopeForPath(path) === 'admin' && deps.hasEditableForm()) return false;
    return true;
  }

  function tryApply(): void {
    if (!pendingTarget) return;
    if (!isSafe() || isReloadBlocked(deps.storage, pendingTarget, deps.now())) {
      deps.onUpdateAvailable(true);
      return;
    }
    recordReload(deps.storage, pendingTarget, deps.now());
    deps.reload();
  }

  async function checkVersion(): Promise<void> {
    if (!deps.currentVersion || checking) return;
    if (deps.now() - lastCheckAt < VERSION_CHECK_MIN_INTERVAL_MS) return;
    checking = true;
    lastCheckAt = deps.now(); // also throttles failures: no retry storm
    try {
      const remote = await deps.fetchRemoteVersion();
      if (versionsDiffer(deps.currentVersion, remote)) {
        pendingTarget = remote;
        tryApply();
      }
    } finally {
      checking = false;
    }
  }

  async function onResume(source: ResumeSource): Promise<void> {
    const now = deps.now();
    if (now - lastResumeAt < RESUME_DEDUPE_MS) return;
    lastResumeAt = now;

    if (source === 'start') {
      // Fresh load: HTML and data are already current. Version drift is still possible.
      if (deps.isOnline()) {
        void deps.updateServiceWorker();
        await checkVersion();
      }
      return;
    }

    const absence = hiddenAt === null ? 0 : now - hiddenAt;
    hiddenAt = null;
    const tier = maxTier(carriedTier, source === 'online' ? 'check' : classifyAbsence(absence));
    if (tier === 'none') return;

    if (!deps.isOnline()) {
      carriedTier = tier; // replayed by the 'online' event, no request now
      return;
    }
    carriedTier = 'none';

    void deps.updateServiceWorker();
    await checkVersion();

    // A reload may have been requested above; otherwise bring data up to date.
    if (TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf('data')) {
      if (deps.isBusy() || isCriticalRoute(deps.pathname())) {
        carriedTier = maxTier(carriedTier, 'data'); // retried on the next resume
      } else {
        deps.refreshData();
      }
    }
    if (tier === 'session' && scopeForPath(deps.pathname()) === 'storefront') {
      await deps.revalidateSession();
    }
  }

  function onChunkError(): void {
    // A bundle that no longer exists is proof of a newer deployment.
    pendingTarget = pendingTarget ?? CHUNK_ERROR_TARGET;
    tryApply();
  }

  function onLockReleased(): void {
    if (!pendingTarget) return;
    cancelSettle?.();
    // Let the user see the result of what they just did before replacing the page.
    cancelSettle = deps.schedule(() => { cancelSettle = null; tryApply(); }, RELEASE_SETTLE_MS);
  }

  async function applyNow(): Promise<void> {
    if (!pendingTarget) return;
    await deps.flushCart();
    recordReload(deps.storage, pendingTarget, deps.now());
    deps.reload();
  }

  return {
    onHidden() { hiddenAt = deps.now(); },
    onResume,
    onChunkError,
    onLockReleased,
    applyNow,
    state: () => ({ pendingTarget, lastCheckAt }),
  };
}

export const CHUNK_ERROR_PATTERN =
  /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i;
