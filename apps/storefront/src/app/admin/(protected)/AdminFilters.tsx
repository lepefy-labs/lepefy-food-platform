'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface AdminFiltersProps {
  currentStatus: string
  currentDateFrom: string
  currentDateTo: string
  currentFulfillment: string
  currentPayment: string
  statusCounts?: Record<string, number>
  hideStatus?: boolean
}

const filters = [
  {
    paramKey: 'status',
    label: 'Statut',
    options: [
      { key: '', label: 'Tous les statuts' },
      { key: 'new', label: 'Nouveau' },
      { key: 'preparing', label: 'En préparation' },
      { key: 'ready_for_pickup', label: 'Prêt à retirer' },
      { key: 'shipped', label: 'Expédié' },
      { key: 'delivered', label: 'Livré' },
      { key: 'cancelled', label: 'Annulé' },
    ],
  },
  {
    paramKey: 'fulfillment',
    label: 'Livraison',
    options: [
      { key: '', label: 'Livraison : toutes' },
      { key: 'delivery', label: 'À domicile' },
      { key: 'pickup', label: 'Click & Collect' },
    ],
  },
  {
    paramKey: 'payment',
    label: 'Paiement',
    options: [
      { key: '', label: 'Paiement : tous' },
      { key: 'stripe', label: 'Carte bancaire' },
      { key: 'satispay', label: 'Satispay' },
      { key: 'in_store', label: 'En magasin' },
    ],
  },
]

function isDefault(value: string | undefined) {
  return !value || value === ''
}

const defaultClass =
  'h-9 text-xs font-medium px-2.5 rounded-lg border border-[var(--admin-border)] ' +
  'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 ' +
  'hover:bg-[var(--admin-surface-subtle)] focus:outline-none cursor-pointer ' +
  'focus:ring-2 focus:ring-[var(--admin-primary)]'

const activeClass =
  'h-9 text-xs font-semibold px-2.5 rounded-lg border cursor-pointer focus:outline-none ' +
  'focus:ring-2 focus:ring-[var(--admin-primary)] ' +
  'border-[#D9D3FF] text-[var(--admin-primary-fg)] bg-[var(--admin-primary-soft)]'

export default function AdminFilters({
  currentStatus,
  currentDateFrom,
  currentDateTo,
  currentFulfillment,
  currentPayment,
  statusCounts,
  hideStatus = false,
}: AdminFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const currentValues: Record<string, string | undefined> = {
    status: currentStatus,
    fulfillment: currentFulfillment,
    payment: currentPayment,
  }

  function handleChange(paramKey: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (!value) params.delete(paramKey)
    else params.set(paramKey, value)
    params.delete('page')
    params.delete('view')
    router.push(`/admin?${params.toString()}`)
  }

  function setDateParam(key: 'dateFrom' | 'dateTo', value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete('page')
    router.push(`/admin?${params.toString()}`)
  }

  function renderSelect(filter: typeof filters[number]) {
    return (
      <select
        key={filter.paramKey}
        value={currentValues[filter.paramKey]}
        onChange={event => handleChange(filter.paramKey, event.target.value)}
        aria-label={filter.label}
        className={isDefault(currentValues[filter.paramKey]) ? defaultClass : activeClass}
      >
        {filter.options.map(option => {
          let label = option.label
          if (filter.paramKey === 'status' && option.key && statusCounts) {
            const count = statusCounts[option.key]
            if (count) label = `${option.label} (${count})`
          }
          return <option key={option.key} value={option.key}>{label}</option>
        })}
      </select>
    )
  }

  const statusFilter = filters.find(filter => filter.paramKey === 'status')!
  const otherFilters = filters.filter(filter => filter.paramKey !== 'status')

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!hideStatus && renderSelect(statusFilter)}

      <div className="flex min-w-0 items-center gap-1">
        <input
          type="date"
          value={currentDateFrom}
          onChange={event => setDateParam('dateFrom', event.target.value)}
          aria-label="Date de début"
          title="Date de début"
          className={isDefault(currentDateFrom) ? defaultClass : activeClass}
        />
        <span className="text-[11px] text-gray-400">→</span>
        <input
          type="date"
          value={currentDateTo}
          onChange={event => setDateParam('dateTo', event.target.value)}
          aria-label="Date de fin"
          title="Date de fin"
          className={isDefault(currentDateTo) ? defaultClass : activeClass}
        />
      </div>

      {otherFilters.map(renderSelect)}
    </div>
  )
}