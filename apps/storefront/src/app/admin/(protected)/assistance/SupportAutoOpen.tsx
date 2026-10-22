'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSupport } from '../../_components/support/SupportProvider';

/** `?nouvelle=1` (command palette « Contacter l’assistance Lepefy ») opens the panel once, then cleans the URL. */
export default function SupportAutoOpen() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { enabled, readOnly, open } = useSupport();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || params.get('nouvelle') !== '1' || !enabled || readOnly) return;
    done.current = true;
    open();
    const next = new URLSearchParams(params.toString());
    next.delete('nouvelle');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname ?? "/admin/assistance", { scroll: false });
  }, [params, enabled, readOnly, open, router, pathname]);

  return null;
}
