// Registry of "do not reload now" locks. A component holding work that a page
// reload would destroy (payment form, unsaved admin form, in-flight write)
// acquires a lock for as long as that work exists. The PWA lifecycle controller
// (lifecycle.ts) applies a new version or refreshes data only when no lock is
// held. Fail-closed by design: an unreleased lock defers the update to a banner,
// it never forces a reload.

type Listener = () => void;

const locks = new Map<symbol, string>();
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** Takes a lock; call the returned function exactly once to release it. */
export function acquireBusy(reason: string): () => void {
  const key = Symbol(reason);
  locks.set(key, reason);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks.delete(key);
    emit();
  };
}

export function isBusy(): boolean {
  return locks.size > 0;
}

export function busyReasons(): string[] {
  return Array.from(new Set(locks.values()));
}

/** Notified when a lock is released (a deferred update may now be applied). */
export function subscribeBusyRelease(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test helper: drops every lock. */
export function resetBusyRegistry(): void {
  locks.clear();
  listeners.clear();
}
