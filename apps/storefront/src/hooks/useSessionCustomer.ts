'use client';

import { useEffect, useState, useCallback } from 'react';

export interface SessionCustomer {
  id:        string;
  email:     string;
  full_name: string | null;
}

export function useSessionCustomer() {
  const [customer, setCustomer] = useState<SessionCustomer | null>(null);
  const [loading, setLoading]   = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res  = await fetch('/api/auth/session');
      const data = await res.json();
      setCustomer(data.customer ?? null);
    } catch {
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { customer, loading, refresh };
}
