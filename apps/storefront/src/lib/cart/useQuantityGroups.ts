'use client';

import { useEffect, useState } from 'react';
import type { PublicQuantityGroup } from '@/app/api/quantity-groups/route';

export interface QuantityGroupsLoadState {
  groups: PublicQuantityGroup[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Never mistake "not loaded" or an API failure for an empty rule set.
 * The cart remains readable, but checkout buttons fail closed until verified.
 */
export function useQuantityGroups(): QuantityGroupsLoadState {
  const [groups, setGroups] = useState<PublicQuantityGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch('/api/quantity-groups', { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('Impossible de vérifier les règles de quantité.');
        const data = await res.json() as { groups?: PublicQuantityGroup[] };
        if (!Array.isArray(data.groups)) throw new Error('Réponse de validation invalide.');
        return data.groups;
      })
      .then((loaded) => {
        if (!controller.signal.aborted) {
          setGroups(loaded);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('Impossible de vérifier les règles de quantité. Réessayez avant de continuer.');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [revision]);

  return { groups, loading, error, reload: () => setRevision((value) => value + 1) };
}
