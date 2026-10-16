import type { PublicQuantityGroup } from '@/app/api/quantity-groups/route';

// Shared client cache of the public quantity groups (GET /api/quantity-groups).
// Every component that needs them (cart drawer, cart page, checkout, product
// page, Nala) reads the same entry: one request in flight at a time, reused
// for `ttlMs`, instead of one request per mounted component.
//
// Pure module (no React): unit-tested with a fake fetcher and clock.
// The server stays authoritative — /api/checkout re-validates every rule.

export type QuantityGroupsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface QuantityGroupsSnapshot {
  groups: PublicQuantityGroup[];
  status: QuantityGroupsStatus;
  /** Set only when no rule set could be loaded: never mistaken for "no groups". */
  error: string | null;
}

export interface QuantityGroupsStoreOptions {
  fetcher: () => Promise<PublicQuantityGroup[]>;
  now?: () => number;
  /** How long a loaded rule set is reused without a new request. */
  ttlMs?: number;
  /** Minimum delay before an automatic retry after a failed first load. */
  errorRetryMs?: number;
  /** Bound on the number of scopes kept in memory. */
  maxScopes?: number;
  errorMessage: string;
}

interface Entry {
  snapshot: QuantityGroupsSnapshot;
  fetchedAt: number | null;
  failedAt: number | null;
  inflight: Promise<void> | null;
  listeners: Set<() => void>;
}

export const IDLE_QUANTITY_GROUPS: QuantityGroupsSnapshot = Object.freeze({ groups: [], status: 'idle', error: null }) as QuantityGroupsSnapshot;

export function createQuantityGroupsStore(options: QuantityGroupsStoreOptions) {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 60_000;
  const errorRetryMs = options.errorRetryMs ?? 10_000;
  const maxScopes = Math.max(1, options.maxScopes ?? 4);
  const entries = new Map<string, Entry>();

  function entry(scope: string): Entry {
    let current = entries.get(scope);
    if (!current) {
      current = { snapshot: IDLE_QUANTITY_GROUPS, fetchedAt: null, failedAt: null, inflight: null, listeners: new Set() };
      entries.set(scope, current);
      // Oldest scope without listeners goes first; a client normally has one scope (its tenant).
      for (const [key, candidate] of entries) {
        if (entries.size <= maxScopes) break;
        if (key !== scope && candidate.listeners.size === 0 && !candidate.inflight) entries.delete(key);
      }
    }
    return current;
  }

  function publish(target: Entry, snapshot: QuantityGroupsSnapshot) {
    target.snapshot = snapshot;
    target.listeners.forEach(listener => listener());
  }

  function load(scope: string): Promise<void> {
    const target = entry(scope);
    if (target.inflight) return target.inflight;
    const previous = target.snapshot;
    // A refresh keeps showing the last known rule set; a first load shows "loading".
    if (previous.status !== 'ready') publish(target, { groups: [], status: 'loading', error: null });
    target.inflight = options.fetcher()
      .then((groups) => {
        target.fetchedAt = now();
        target.failedAt = null;
        publish(target, { groups, status: 'ready', error: null });
      })
      .catch(() => {
        target.failedAt = now();
        if (previous.status === 'ready') publish(target, previous);
        else publish(target, { groups: [], status: 'error', error: options.errorMessage });
      })
      .finally(() => { target.inflight = null; });
    return target.inflight;
  }

  return {
    getSnapshot(scope: string): QuantityGroupsSnapshot {
      return entries.get(scope)?.snapshot ?? IDLE_QUANTITY_GROUPS;
    },
    subscribe(scope: string, listener: () => void): () => void {
      const target = entry(scope);
      target.listeners.add(listener);
      return () => { target.listeners.delete(listener); };
    },
    /** Loads when needed: nothing yet, expired, or a failed load old enough to retry. */
    ensure(scope: string): Promise<void> {
      const target = entry(scope);
      if (target.inflight) return target.inflight;
      const at = now();
      if (target.snapshot.status === 'ready' && target.fetchedAt !== null && at - target.fetchedAt < ttlMs) return Promise.resolve();
      if (target.snapshot.status === 'error' && target.failedAt !== null && at - target.failedAt < errorRetryMs) return Promise.resolve();
      return load(scope);
    },
    /** Explicit reload (« Réessayer », after a known change): always a new request. */
    invalidate(scope: string): Promise<void> {
      const target = entry(scope);
      target.fetchedAt = null;
      target.failedAt = null;
      return target.inflight ?? load(scope);
    },
    scopeCount(): number {
      return entries.size;
    },
  };
}

export type QuantityGroupsStore = ReturnType<typeof createQuantityGroupsStore>;

/** Parses the API payload; anything else is a failure, never an empty rule set. */
export async function readQuantityGroupsResponse(res: Response): Promise<PublicQuantityGroup[]> {
  if (!res.ok) throw new Error('quantity groups unavailable');
  const data = await res.json() as { groups?: PublicQuantityGroup[] };
  if (!Array.isArray(data.groups)) throw new Error('invalid quantity groups payload');
  return data.groups;
}
