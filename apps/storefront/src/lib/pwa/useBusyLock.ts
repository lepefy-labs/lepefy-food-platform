'use client';

import { useEffect } from 'react';
import { acquireBusy } from './busyRegistry';

/** Holds a "do not reload" lock while `active` is true (and the component is mounted). */
export function useBusyLock(active: boolean, reason: string): void {
  useEffect(() => {
    if (!active) return;
    return acquireBusy(reason);
  }, [active, reason]);
}
