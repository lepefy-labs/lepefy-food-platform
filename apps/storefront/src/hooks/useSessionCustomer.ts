'use client';

import { useEffect, useState, useCallback } from 'react';

export interface SessionCustomer {
  id:        string;
  email:     string;
  full_name: string | null;
}

// État partagé entre toutes les instances du hook (Header, BottomNav,
// CartSyncProvider, bandeau d'achat…) : une seule requête /api/auth/session
// par chargement de page au lieu d'une par composant monté.
let sharedCustomer: SessionCustomer | null = null;
let resolved = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(listener => listener());
}

function fetchSession(): Promise<void> {
  // Une lecture déjà en vol a pu partir avant un login/logout : on enchaîne
  // une nouvelle lecture après elle plutôt que de réutiliser son résultat.
  if (inflight) return inflight.then(fetchSession);
  inflight = (async () => {
    try {
      const res  = await fetch('/api/auth/session');
      const data = await res.json();
      sharedCustomer = data.customer ?? null;
    } catch {
      sharedCustomer = null;
    } finally {
      resolved = true;
      inflight = null;
      notify();
    }
  })();
  return inflight;
}

if (typeof window !== 'undefined') {
  window.addEventListener('lepefy:customer-authenticated', () => { void fetchSession(); });
  window.addEventListener('lepefy:customer-logged-out', () => {
    sharedCustomer = null;
    resolved = true;
    notify();
  });
}

export function useSessionCustomer() {
  const [customer, setCustomer] = useState<SessionCustomer | null>(sharedCustomer);
  const [loading, setLoading]   = useState(!resolved);

  // refresh() force toujours une nouvelle lecture (login/logout) et la
  // propage à toutes les instances montées.
  const refresh = useCallback(() => fetchSession(), []);

  useEffect(() => {
    const sync = () => {
      setCustomer(sharedCustomer);
      setLoading(!resolved);
    };
    listeners.add(sync);
    if (resolved) sync();
    else if (!inflight) void fetchSession();
    return () => { listeners.delete(sync); };
  }, []);

  return { customer, loading, refresh };
}
