import Link from 'next/link'
import { IconArrowLeft, IconPlus } from '@tabler/icons-react'
import { getTenant } from '@/lib/tenant/getTenant'
import AdminPageHeader from '../../../_components/ui/AdminPageHeader'
import PreordersListClient from './PreordersListClient'

export const dynamic = 'force-dynamic'

export default async function PreordersPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood')
  return (
    <div className="mx-auto w-full max-w-6xl pb-8">
      <Link href="/admin" className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-gray-500 hover:bg-[var(--admin-surface-subtle)] hover:text-gray-900 dark:text-gray-400">
        <IconArrowLeft size={17} /> Commandes
      </Link>
      <AdminPageHeader
        title="Précommandes"
        description="Achats saisis par l’équipe en attente de paiement. Ils ne comptent pas dans le chiffre d’affaires tant qu’ils ne sont pas payés."
        compact
        actions={(
          <Link href="/admin/orders/new" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white hover:opacity-90">
            <IconPlus size={17} /> Nouvelle commande
          </Link>
        )}
      />
      <PreordersListClient currency={tenant.currency ?? 'EUR'} />
    </div>
  )
}
