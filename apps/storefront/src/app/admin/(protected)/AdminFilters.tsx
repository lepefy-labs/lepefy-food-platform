'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface AdminFiltersProps {
  currentStatus:      string
  currentDateFrom:    string
  currentDateTo:      string
  currentFulfillment: string
  currentPayment:     string
  statusCounts?:      Record<string, number>
}

const filters = [
  {
    paramKey: 'status',
    label:    'Statut',
    options: [
      { key: '',                 label: 'Tous les statuts' },
      { key: 'new',              label: 'Nouveau' },
      { key: 'preparing',        label: 'En préparation' },
      { key: 'ready_for_pickup', label: 'Prêt à retirer' },
      { key: 'shipped',          label: 'Expédié' },
      { key: 'delivered',        label: 'Livré' },
      { key: 'cancelled',        label: 'Annulé' },
    ],
  },
  {
    paramKey: 'fulfillment',
    label:    'Livraison',
    options: [
      { key: '',          label: 'Tous les types' },
      { key: 'delivery',  label: 'Livraison à domicile' },
      { key: 'pickup',    label: 'Click & Collect' },
    ],
  },
  {
    paramKey: 'payment',
    label:    'Paiement',
    options: [
      { key: '',          label: 'Tous les modes' },
      { key: 'stripe',    label: 'Carte bancaire' },
      { key: 'satispay',  label: 'Satispay' },
      { key: 'in_store',  label: 'En magasin' },
    ],
  },
]

function isDefault(value: string | undefined) {
  return !value || value === ''
}

const defaultClass =
  'text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 ' +
  'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 ' +
  'hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none cursor-pointer ' +
  'focus:ring-2 focus:ring-[var(--color-primary)]'

const activeClass =
  'text-xs font-medium px-3 py-1.5 rounded-lg border cursor-pointer focus:outline-none ' +
  'focus:ring-2 focus:ring-[var(--color-primary)] ' +
  'border-[var(--color-primary)] text-[var(--color-primary-dark)] bg-[var(--color-primary-light,#f0fdf4)]'

export default function AdminFilters({
  currentStatus,
  currentDateFrom,
  currentDateTo,
  currentFulfillment,
  currentPayment,
  statusCounts,
}: AdminFiltersProps) {
  const router      = useRouter()
  const searchParams = useSearchParams()

  const currentValues: Record<string, string | undefined> = {
    status:      currentStatus,
    fulfillment: currentFulfillment,
    payment:     currentPayment,
  }

  function handleChange(paramKey: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (!value) {
      params.delete(paramKey)
    } else {
      params.set(paramKey, value)
    }
    router.push(`/admin?${params.toString()}`)
  }

  function setDateParam(key: 'dateFrom' | 'dateTo', value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value); else params.delete(key)
    router.push(`/admin?${params.toString()}`)
  }

  function renderSelect(f: typeof filters[number]) {
    return (
      <select
        key={f.paramKey}
        value={currentValues[f.paramKey]}
        onChange={e => handleChange(f.paramKey, e.target.value)}
        className={
          isDefault(currentValues[f.paramKey])
            ? defaultClass
            : activeClass
        }
      >
        {f.options.map(o => {
          let label = o.label
          if (f.paramKey === 'status' && o.key && statusCounts) {
            const count = statusCounts[o.key]
            if (count) label = `${o.label} (${count})`
          }
          return <option key={o.key} value={o.key}>{label}</option>
        })}
      </select>
    )
  }

  const statusFilter = filters.find(f => f.paramKey === 'status')!
  const otherFilters  = filters.filter(f => f.paramKey !== 'status')

  return (
    <div className="flex flex-wrap gap-2 mb-4 items-center">
      {renderSelect(statusFilter)}

      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={currentDateFrom}
          onChange={e => setDateParam('dateFrom', e.target.value)}
          aria-label="Date de début"
          className={isDefault(currentDateFrom) ? defaultClass : activeClass}
        />
        <span className="text-xs text-gray-400">→</span>
        <input
          type="date"
          value={currentDateTo}
          onChange={e => setDateParam('dateTo', e.target.value)}
          aria-label="Date de fin"
          className={isDefault(currentDateTo) ? defaultClass : activeClass}
        />
      </div>

      {otherFilters.map(renderSelect)}
    </div>
  )
}
