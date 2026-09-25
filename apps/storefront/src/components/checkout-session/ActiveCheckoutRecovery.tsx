'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import { useTenant } from '@/providers/TenantProvider';
import { ActiveCheckoutRecoveryBar, isCheckoutRecoveryPath } from './ActiveCheckoutRecoveryBar';

interface ActiveSession {
  id: string;
  itemCount: number;
  total: number;
}

// Résolu côté client (et non plus dans le layout serveur) pour que le layout
// boutique ne lise jamais les cookies : les invités ne font aucun appel, et
// un client connecté ne paie la requête que sur les pages où le bandeau
// s'affiche.
export function ActiveCheckoutRecovery() {
  const tenant = useTenant();
  const pathname = usePathname();
  const { customer } = useSessionCustomer();
  const [session, setSession] = useState<ActiveSession | null>(null);
  const onRecoveryPath = isCheckoutRecoveryPath(pathname);

  useEffect(() => {
    if (!customer || !onRecoveryPath) {
      if (!customer) setSession(null);
      return;
    }
    const controller = new AbortController();
    fetch('/api/checkout-sessions/active', { cache: 'no-store', signal: controller.signal })
      .then(res => (res.ok ? res.json() : { session: null }))
      .then((data: { session?: ActiveSession | null }) => setSession(data.session ?? null))
      .catch(() => {
        // Bandeau purement informatif : un échec réseau le masque simplement.
      });
    return () => controller.abort();
  }, [customer, onRecoveryPath, pathname]);

  if (!session) return null;

  return (
    <ActiveCheckoutRecoveryBar
      sessionId={session.id}
      itemCount={session.itemCount}
      total={session.total}
      currency={tenant.currency ?? 'eur'}
    />
  );
}
