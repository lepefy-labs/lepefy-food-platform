import Link from 'next/link'
import { IconArrowLeft } from '@tabler/icons-react'
import { getTenant } from '@/lib/tenant/getTenant'
import AdminPageHeader from '../../../_components/ui/AdminPageHeader'
import AssistedOrderForm from '../_assisted/AssistedOrderForm'

export const dynamic = 'force-dynamic'

export default async function NewAssistedOrderPage({ searchParams = {} }: { searchParams?: { customer?: string } }) {
  // `?customer=<id>` (from a CRM customer page) preselects that customer; the form re-reads it tenant-scoped.
  const prefillCustomerId = typeof searchParams.customer === 'string' && /^[0-9a-f-]{36}$/i.test(searchParams.customer) ? searchParams.customer : null
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood')
  return (
    <div className="mx-auto w-full max-w-6xl">
      <Link href="/admin" className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-a-text-3 hover:bg-a-surface-2 hover:text-a-text">
        <IconArrowLeft size={17} /> Commandes
      </Link>
      <AdminPageHeader
        title="Nouvelle commande"
        description="Enregistrez un achat reçu par WhatsApp, téléphone, Instagram ou en magasin. Aucune commande n’est créée avant la confirmation du paiement."
        compact
      />
      <AssistedOrderForm currency={tenant.currency ?? 'EUR'} defaultCountry={(tenant.country ?? 'IT').toUpperCase()} prefillCustomerId={prefillCustomerId} />
    </div>
  )
}
