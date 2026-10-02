'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { ORDER_SORT_OPTIONS, type OrderSortKey } from '@/lib/orders/adminOrderOperations'

/** Sort of the orders work queue, kept in the query string (`priority` = default, omitted). */
export default function OrdersSortSelect({ value }: { value: OrderSortKey }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'priority') params.delete('sort')
    else params.set('sort', next)
    params.delete('page')
    const query = params.toString()
    router.push(query ? `/admin?${query}` : '/admin')
  }

  return (
    <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
      <span className="shrink-0">Tri</span>
      <select
        value={value}
        onChange={event => change(event.target.value)}
        className="h-10 rounded-xl border border-[var(--admin-border)] bg-white px-2.5 text-xs font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
      >
        {ORDER_SORT_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
    </label>
  )
}
