'use client';

import { useEffect, useState } from 'react';
import type { PublicQuantityGroup } from '@/app/api/quantity-groups/route';

/**
 * Groupes de quantité combinable actifs pour le tenant courant (ex. "Boissons").
 * Chargés une fois par montage — liste courte, rafraîchie à chaque visite du
 * panier, jamais lue depuis le localStorage (source de vérité = serveur).
 */
export function useQuantityGroups(): PublicQuantityGroup[] {
  const [groups, setGroups] = useState<PublicQuantityGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/quantity-groups')
      .then((res) => (res.ok ? res.json() : { groups: [] }))
      .then((data: { groups?: PublicQuantityGroup[] }) => {
        if (!cancelled) setGroups(data.groups ?? []);
      })
      .catch(() => { if (!cancelled) setGroups([]); });
    return () => { cancelled = true; };
  }, []);

  return groups;
}
