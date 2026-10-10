import Link from 'next/link'
import { Suspense } from 'react'
import { IconArrowLeft, IconPlus } from '@tabler/icons-react'
import { getTenant } from '@/lib/tenant/getTenant'
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac'
import AdminPageHeader from '../../../_components/ui/AdminPageHeader'
import PreordersListClient from './PreordersListClient'

export const dynamic = 'force-dynamic'

export default async function PreordersPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood')
  // UI hint only: POST /api/admin/assisted-orders/[id]/cancel re-checks orders.manage.
  const access = await getCurrentAdminAccessContext(tenant.id)
  const canManage = Boolean(access && canAdmin(access, 'orders.manage'))
  return (
    <div className="mx-auto w-full max-w-6xl pb-8">
      <Link href="/admin" className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-a-text-3 hover:bg-a-surface-2 hover:text-a-text">
        <IconArrowLeft size={17} /> Commandes
      </Link>
      <AdminPageHeader
        title="Précommandes"
        description="Achats saisis par l’équipe, jusqu’au paiement. Traitez d’abord les paiements à vérifier ; ils ne comptent dans le chiffre d’affaires qu’une fois payés."
        compact
        actions={(
          <Link href="/admin/orders/new" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-a-brand px-4 text-sm font-semibold text-a-on-brand hover:opacity-90">
            <IconPlus size={17} /> Nouvelle commande
          </Link>
        )}
      />
      <Suspense fallback={<p className="py-12 text-center text-sm text-a-text-3">Chargement…</p>}>
        <PreordersListClient currency={tenant.currency ?? 'EUR'} canManage={canManage} />
      </Suspense>
    </div>
  )
}
