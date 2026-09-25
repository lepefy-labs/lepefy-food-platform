import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { IconArrowLeft } from '@tabler/icons-react'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { EDITABLE_PREORDER_STATUSES, preorderReference } from '@/lib/orders/assisted/assistedOrderPolicy'
import { loadAssistedSession } from '@/lib/orders/assisted/assistedOrderServer'
import AdminPageHeader from '../../../../../_components/ui/AdminPageHeader'
import AssistedOrderForm from '../../../_assisted/AssistedOrderForm'

export const dynamic = 'force-dynamic'

export default async function EditPreorderPage({ params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood')
  const session = await loadAssistedSession(createServiceClient(), tenant.id, params.id).catch(() => null)
  if (!session) notFound()
  if (!EDITABLE_PREORDER_STATUSES.includes(session.status) || session.order_id) {
    redirect(`/admin/orders/precommandes/${session.id}`)
  }

  const reference = preorderReference(session.id)
  return (
    <div className="mx-auto w-full max-w-6xl">
      <Link href={`/admin/orders/precommandes/${session.id}`} className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-gray-500 hover:bg-[var(--admin-surface-subtle)] hover:text-gray-900 dark:text-gray-400">
        <IconArrowLeft size={17} /> {reference}
      </Link>
      <AdminPageHeader title={`Modifier ${reference}`} description="Articles, prix et livraison sont revalidés par le serveur à l’enregistrement." compact />
      <AssistedOrderForm
        currency={tenant.currency ?? 'EUR'}
        defaultCountry={(tenant.country ?? 'IT').toUpperCase()}
        initial={{
          preorderId: session.id,
          reference,
          status: session.status,
          hadActiveLink: Boolean(session.pay_token_hash) && session.status === 'open',
          salesChannel: session.sales_channel,
          customer: {
            id: session.customer_id,
            fullName: session.full_name ?? '',
            email: session.email ?? '',
            phone: session.phone ?? '',
          },
          items: session.items ?? [],
          fulfillmentType: session.fulfillment_type,
          shippingAddress: session.shipping_address,
          adminNote: session.admin_note ?? '',
        }}
      />
    </div>
  )
}
