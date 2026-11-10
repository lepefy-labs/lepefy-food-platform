'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Counts of the sidebar views (e.g. Commandes › Suivi opérationnel), published
 * by the list page that already computed them (the work queue KPIs). The shared
 * layout never loads them: no query is added to other admin pages. Values stay
 * in memory for the browser session, so a sub-page of the module (Session de
 * préparation, Précommandes) shows the counts of the last list render; they are
 * refreshed each time the list renders (navigation, polling refresh).
 */
type Counts = Readonly<Record<string, number>>;

const EMPTY: Counts = Object.freeze({});
const store = new Map<string, Counts>();
const listeners = new Set<() => void>();

function emit() { listeners.forEach((listener) => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export function publishNavCounts(scope: string, counts: Counts | null): void {
  const current = store.get(scope);
  if (counts === null) { if (current) { store.delete(scope); emit(); } return; }
  if (current && Object.keys(counts).length === Object.keys(current).length && Object.entries(counts).every(([key, value]) => current[key] === value)) return;
  store.set(scope, Object.freeze({ ...counts }));
  emit();
}

/** Counts of a scope ({} before the list page published them, and on the server). */
export function useNavCounts(scope: string): Counts {
  return useSyncExternalStore(subscribe, () => store.get(scope) ?? EMPTY, () => EMPTY);
}

/** Rendered by a list page: publishes its counts to the sidebar. `null` = counts unavailable (no badge). */
export function NavCountsPublisher({ scope, counts }: { scope: string; counts: Counts | null }) {
  const key = counts ? JSON.stringify(counts) : '';
  useEffect(() => { publishNavCounts(scope, counts); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scope, key]);
  return null;
}
