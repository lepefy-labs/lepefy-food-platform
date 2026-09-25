import Link from 'next/link'
import { IconArrowLeft } from '@tabler/icons-react'
import PreorderDetailClient from './PreorderDetailClient'

export const dynamic = 'force-dynamic'

export default function PreorderDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { created?: string; updated?: string }
}) {
  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <Link href="/admin/orders/precommandes" className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-gray-500 hover:bg-[var(--admin-surface-subtle)] hover:text-gray-900 dark:text-gray-400">
        <IconArrowLeft size={17} /> Précommandes
      </Link>
      <PreorderDetailClient
        preorderId={params.id}
        notice={searchParams.created === '1' ? 'created' : searchParams.updated === '1' ? 'updated' : null}
      />
    </div>
  )
}
