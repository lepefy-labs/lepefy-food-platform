'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Layouts persist across client-side navigation in Next.js App Router.
 * Check the current browser route instead of the path captured on the
 * initial server request, so billing remains payment-first in the PWA too.
 */
export default function AdminGlobalNotices({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/admin/billing' || pathname === '/admin/billing/') return null;
  return <>{children}</>;
}
