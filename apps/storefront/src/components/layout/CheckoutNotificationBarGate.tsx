'use client';

import { usePathname } from 'next/navigation';
import { ShopNotificationBar } from './ShopNotificationBar';

export function CheckoutNotificationBarGate() {
  const pathname = usePathname();
  if (pathname.startsWith('/checkout')) return null;
  return <ShopNotificationBar />;
}
