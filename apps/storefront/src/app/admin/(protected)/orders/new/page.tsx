import Link from 'next/link'
import { IconArrowLeft } from '@tabler/icons-react'
import { getTenant } from '@/lib/tenant/getTenant'
import AdminPageHeader from '../../../_components/ui/AdminPageHeader'
import AssistedOrderForm from '../_assisted/AssistedOrderForm'

export const dynamic = 'force-dynamic'

export default async function NewAssistedOrderPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood')
  return (
    <div className="mx-auto w-full max-w-6xl">
      <Link href="/admin" className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-gray-500 hover:bg-[var(--admin-surface-subtle)] hover:text-gray-900 dark:text-gray-400">
        <IconArrowLeft size={17} /> Commandes
      </Link>
      <AdminPageHeader
        title="Nouvelle commande"
        description="Enregistrez un achat reçu par WhatsApp, téléphone, Instagram ou en magasin. Aucune commande n’est créée avant la confirmation du paiement."
        compact
      />
      <AssistedOrderForm currency={tenant.currency ?? 'EUR'} defaultCountry={(tenant.country ?? 'IT').toUpperCase()} />
    </div>
  )
}
