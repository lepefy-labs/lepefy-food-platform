'use client';

import { useEffect } from 'react';
import { recordAppEvent, rememberedAppSource } from '@/lib/pwa/recordAppEvent';

const LAUNCH_KEY = 'lepefy-app-launch-counted';

/**
 * Mesure de l'application installable (migration 186), montée une fois dans
 * le layout boutique : une ouverture depuis l'icône par session, et
 * l'installation (`appinstalled`) attribuée à la source de la visite de /app
 * ou du bandeau. Ne rend rien, ne lit ni cookie ni compte.
 */
export function AppUsageTracker() {
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      try {
        if (!sessionStorage.getItem(LAUNCH_KEY)) {
          sessionStorage.setItem(LAUNCH_KEY, '1');
          recordAppEvent('standalone_launch', 'direct');
        }
      } catch {
        // Stockage indisponible : on ne compte pas plutôt que de compter à chaque page.
      }
    }
    const onInstalled = () => recordAppEvent('app_installed', rememberedAppSource('direct'));
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, []);
  return null;
}
