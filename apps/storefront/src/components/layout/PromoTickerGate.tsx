'use client';

import { usePathname } from 'next/navigation';
import { shouldShowPromoTicker } from '@/lib/storefront/shopChrome';
import { ShopNotificationBar } from './ShopNotificationBar';

/** Le bandeau défilant reste sur « Découvrir » : jamais sur les pages d'achat. */
export function PromoTickerGate() {
  const pathname = usePathname();
  if (!shouldShowPromoTicker(pathname)) return null;
  return <ShopNotificationBar />;
}
