'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * While images are being created, refreshes the server list every 5 s, only
 * when the tab is visible (no polling in the background). Renders a live
 * region so screen readers hear that the list updates.
 */
export default function StudioLibraryRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [active, router]);
  if (!active) return null;
  return <p className="text-xs text-a-text-3" aria-live="polite">Des images sont en cours de création : la liste se met à jour toute seule.</p>;
}
