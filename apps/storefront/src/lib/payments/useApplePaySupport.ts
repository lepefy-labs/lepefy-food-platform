'use client';

import { useEffect, useState } from 'react';
import { detectApplePayClientSupport } from './applePay';

// `false` au rendu serveur et au premier rendu client (pas de mismatch
// d'hydratation), puis mis à jour après le montage : `window` n'est jamais
// lu pendant le rendu.
export function useApplePaySupport(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(detectApplePayClientSupport(window as unknown as Parameters<typeof detectApplePayClientSupport>[0]));
  }, []);
  return supported;
}
