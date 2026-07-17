'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface AdminFiltersProps {
  currentStatus:      string
  currentPeriod:      string
  currentFulfillment: string
  currentPayment:     string
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
    paramKey: 'period',
    label:    'Période',
    options: [
      { key: 'all',   label: 'Toutes les dates' },
      { key: 'today', label: "Aujourd'hui" },
      { key: 'week',  label: 'Cette semaine' },
      { key: 'month', label: 'Ce mois' },
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

function isDefault(paramKey: string, value: string | undefined) {
  if (paramKey === 'period') return !value || value === 'all' || value === ''
  return !value || value === ''
}

const defaultClass =
  'text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 ' +
  'bg-white text-gray-700 hover:bg-gray-50 focus:outline-none cursor-pointer ' +
  'focus:ring-2 focus:ring-[var(--color-primary)]'

const activeClass =
  'text-xs font-medium px-3 py-1.5 rounded-lg border cursor-pointer focus:outline-none ' +
  'focus:ring-2 focus:ring-[var(--color-primary)] ' +
  'border-[var(--color-primary)] text-[var(--color-primary-dark)] bg-[var(--color-primary-light,#f0fdf4)]'

export default function AdminFilters({
  currentStatus,
  currentPeriod,
  currentFulfillment,
  currentPayment,
}: AdminFiltersProps) {
  const router      = useRouter()
  const searchParams = useSearchParams()

  const currentValues: Record<string, string | undefined> = {
    status:      currentStatus,
    period:      currentPeriod,
    fulfillment: currentFulfillment,
    payment:     currentPayment,
  }

  function handleChange(paramKey: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (!value || value === 'all') {
      params.delete(paramKey)
    } else {
      params.set(paramKey, value)
    }
    router.push(`/admin?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {filters.map(f => (
        <select
          key={f.paramKey}
          value={currentValues[f.paramKey]}
          onChange={e => handleChange(f.paramKey, e.target.value)}
          className={
            isDefault(f.paramKey, currentValues[f.paramKey])
              ? defaultClass
              : activeClass
          }
        >
          {f.options.map(o => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      ))}
    </div>
  )
}
