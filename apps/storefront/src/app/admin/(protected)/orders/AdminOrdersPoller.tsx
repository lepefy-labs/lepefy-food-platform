'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const POLL_INTERVAL_MS = 18_000; // 18s — impercettibile per <10 ordini/giorno, leggero sul DB

export default function AdminOrdersPoller({
  onNewOrders,
  isEditing,
}: {
  onNewOrders?: (orders: { id: string }[]) => void;
  /** true quando l'operatore ha un'edizione attiva in corso (es. il pannello
   *  tracking della Fase 3 aperto) — il poll continua a girare per non perdere
   *  eventi, ma il refresh viene rimandato per non interrompere il lavoro. */
  isEditing?: boolean;
}) {
  const router       = useRouter();
  const sinceRef     = useRef(new Date().toISOString());
  const pendingRef   = useRef(false); // c'è un refresh in sospeso perché isEditing era true?
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      // Non pollare se la scheda è in background — inutile e spreca chiamate
      if (document.hidden) return;

      try {
        const res = await fetch(`/api/admin/orders/poll?since=${encodeURIComponent(sinceRef.current)}`);
        if (!res.ok || cancelled) return;

        const data = await res.json();
        sinceRef.current = data.checkedAt;

        if (data.hasChanges) {
          if (data.newOrders?.length > 0) onNewOrders?.(data.newOrders);

          // Guardia anti-interruzione: se l'operatore sta compilando qualcosa
          // (es. il pannello tracking della Fase 3), non forzare un refresh
          // adesso — segna solo che c'è un aggiornamento in sospeso.
          if (isEditingRef.current) {
            pendingRef.current = true;
          } else {
            router.refresh();
          }
        }
      } catch {
        // Silenzioso — un fallimento occasionale del polling non deve disturbare l'admin
      }
    }

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    // Un giro subito quando la tab torna visibile, non solo a intervallo fisso
    document.addEventListener('visibilitychange', poll);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [router, onNewOrders]);

  // Appena l'edizione finisce, applica subito l'eventuale refresh rimasto in sospeso
  useEffect(() => {
    if (!isEditing && pendingRef.current) {
      pendingRef.current = false;
      router.refresh();
    }
  }, [isEditing, router]);

  return null;
}
