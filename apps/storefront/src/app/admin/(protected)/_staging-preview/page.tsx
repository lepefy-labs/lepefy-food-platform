'use client';

import { useState } from 'react';
import '@/_tailadmin-staging/styles/globals.css';
import StagingShell from '@/_tailadmin-staging/components/layout/StagingShell';
import { EcommerceMetrics } from '@/_tailadmin-staging/components/ecommerce/EcommerceMetrics';
import BasicTableOne from '@/_tailadmin-staging/components/tables/BasicTableOne';
import Pagination from '@/_tailadmin-staging/components/tables/Pagination';

/**
 * Temporary visual-verification page for the TailAdmin v2.3.0 -> Next.js
 * 14 / React 18 / Tailwind v3 porting cycle. Renders the ported layout
 * (sidebar + topbar) and dashboard components (stat cards + generic table)
 * with dummy data — nothing here is wired to real tenant/order data yet.
 *
 * Lives under `admin/(protected)/` so it inherits the same auth check as
 * every other admin route (see `(protected)/layout.tsx`); no separate auth
 * code was added. Rename or delete this page once the ported components are
 * integrated into the real admin routes in a future cycle.
 */
export default function StagingPreviewPage() {
  const [page, setPage] = useState(1);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-warning-300 bg-warning-50 p-4 text-sm text-warning-800 dark:border-warning-800 dark:bg-warning-950 dark:text-warning-200">
        Aperçu du portage TailAdmin v2.3.0 — composants isolés dans{' '}
        <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">src/_tailadmin-staging/</code>, données factices,
        pas encore connectés aux vraies données. À retirer une fois le portage intégré aux vraies routes admin.
      </div>

      <StagingShell>
        <div className="grid grid-cols-12 gap-4 md:gap-6">
          <div className="col-span-12">
            <EcommerceMetrics />
          </div>
          <div className="col-span-12 space-y-4">
            <BasicTableOne />
            <Pagination currentPage={page} totalPages={5} onPageChange={setPage} />
          </div>
        </div>
      </StagingShell>
    </div>
  );
}
