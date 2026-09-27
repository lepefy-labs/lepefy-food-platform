'use client';

import { useMemo, useState } from 'react';
import { IconSearch } from '@tabler/icons-react';
import type { CoverageRow, CoverageStatus, PostalCoverage } from '@/lib/shipping/intelligence/campaignCoverage';
import { ERROR_REASONS, type ErrorReasonCode } from '@/lib/shipping/intelligence/campaignErrorReasons';

const STATUS_LABEL: Record<CoverageStatus, string> = {
  complete: 'Couverture complète',
  partial: 'Couverture partielle',
  todo: 'À compléter',
  incompatible: 'Données historiques incompatibles',
  rejected: 'CAP refusé par Packlink',
};
const STATUS_CLS: Record<CoverageStatus, string> = {
  complete: 'bg-green-50 text-green-700',
  partial: 'bg-blue-50 text-blue-700',
  todo: 'bg-gray-100 text-gray-600',
  incompatible: 'bg-amber-50 text-amber-800',
  rejected: 'bg-red-50 text-red-700',
};

type Filter = 'all' | 'needs_work' | 'incompatible' | 'complete';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'needs_work', label: 'À mesurer' },
  { value: 'incompatible', label: 'Incompatibles' },
  { value: 'complete', label: 'Complets' },
  { value: 'all', label: 'Tous' },
];

function formatKg(value: number): string {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function formatCost(row: CoverageRow): string {
  if (row.minCost === null || row.maxCost === null) return '—';
  return row.minCost === row.maxCost
    ? `${row.minCost.toFixed(2)} €`
    : `${row.minCost.toFixed(2)}–${row.maxCost.toFixed(2)} €`;
}

function Progress({ row }: { row: CoverageRow }) {
  const valid = row.quoted + row.reusedValid;
  const pct = row.planned > 0 ? Math.round((valid / row.planned) * 100) : 0;
  return (
    <div className="min-w-[8rem]">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-gray-800 dark:text-gray-200">{valid}/{row.planned}</span>
        <span className="text-2xs text-gray-400">{row.quoted} nouv. · {row.reusedValid} réempl.</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden>
        <div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
      </div>
      {(row.pending + row.running) > 0 && (
        <p className="mt-0.5 text-2xs text-gray-500">
          {[
            row.pending > 0 ? `${row.pending} en attente` : null,
            row.running > 0 ? `${row.running} en cours` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      )}
      {Object.entries(row.reasons).map(([code, count]) => (
        <p key={code} className="mt-0.5 text-2xs text-red-700" title={ERROR_REASONS[code as ErrorReasonCode].explanation}>
          {count} × {ERROR_REASONS[code as ErrorReasonCode].label}
        </p>
      ))}
      {row.missingWeightsKg.length > 0 && row.missingWeightsKg.length < row.plannedWeightsKg.length && (
        <p className="mt-0.5 text-2xs text-gray-400" title={`Poids couverts : ${row.coveredWeightsKg.map(formatKg).join(' · ')} kg`}>
          Manquants : {row.missingWeightsKg.map(formatKg).join(' · ')} kg
        </p>
      )}
    </div>
  );
}

export function CampaignCoverageTable({ rows, postalCodes }: { rows: CoverageRow[]; postalCodes: PostalCoverage[] }) {
  const [filter, setFilter] = useState<Filter>(() => (rows.some((r) => r.status !== 'complete') ? 'needs_work' : 'all'));
  const [query, setQuery] = useState('');

  const counts = useMemo(() => ({
    all: rows.length,
    needs_work: rows.filter((r) => r.status !== 'complete' && r.status !== 'rejected').length,
    incompatible: rows.filter((r) => r.status === 'incompatible').length,
    complete: rows.filter((r) => r.status === 'complete').length,
  }), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'needs_work' && (r.status === 'complete' || r.status === 'rejected')) return false;
      if (filter === 'incompatible' && r.status !== 'incompatible') return false;
      if (filter === 'complete' && r.status !== 'complete') return false;
      if (!q) return true;
      return r.postalCode.toLowerCase().includes(q)
        || (r.city ?? '').toLowerCase().includes(q)
        || (r.zoneCode ?? '').toLowerCase().includes(q)
        || r.profileName.toLowerCase().includes(q);
    });
  }, [filter, query, rows]);

  if (rows.length === 0) {
    return <p className="text-sm text-gray-400">Aucun scénario dans cette campagne.</p>;
  }

  const completePostal = postalCodes.filter((p) => p.status === 'complete').length;

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrer la couverture">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={`min-h-9 px-3 py-1 text-xs rounded-full border ${filter === f.value ? 'border-[var(--color-primary)] text-[var(--color-primary-dark)] bg-[var(--color-primary)]/5' : 'border-gray-200 text-gray-500'}`}
            >
              {f.label} <span className="text-gray-400">{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-56">
          <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="CAP, ville, zone…"
            aria-label="Rechercher un CAP"
            className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
        </div>
      </div>

      <p className="text-2xs text-gray-400 mb-2">{completePostal}/{postalCodes.length} CAP entièrement couverts · une ligne par CAP × profil d&apos;emballage.</p>

      {visible.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">Aucune ligne pour ce filtre.</p>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2 pr-3">CAP</th><th className="py-2 pr-3">Ville</th><th className="py-2 pr-3">Zone</th>
                  <th className="py-2 pr-3">Profil</th><th className="py-2 pr-3">Progression</th><th className="py-2 pr-3">Devis</th>
                  <th className="py-2 pr-3">Dernier devis valide</th><th className="py-2 pr-3">Couverture</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.key} className="border-b border-gray-50 dark:border-gray-800/60 align-top">
                    <td className="py-2.5 pr-3 font-medium tabular-nums">{r.country} {r.postalCode}</td>
                    <td className="py-2.5 pr-3 text-gray-600">{r.city ?? '—'}</td>
                    <td className="py-2.5 pr-3 text-gray-500">{r.zoneCode ?? '—'}</td>
                    <td className="py-2.5 pr-3">{r.profileName}</td>
                    <td className="py-2.5 pr-3"><Progress row={r} /></td>
                    <td className="py-2.5 pr-3 text-gray-600 whitespace-nowrap">{formatCost(r)}</td>
                    <td className="py-2.5 pr-3 text-gray-400 whitespace-nowrap">{r.lastValidQuoteAt ? new Date(r.lastValidQuoteAt).toLocaleDateString('fr-FR') : '—'}</td>
                    <td className="py-2.5 pr-3"><span className={`text-2xs font-semibold px-1.5 py-0.5 rounded ${STATUS_CLS[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="md:hidden space-y-2">
            {visible.map((r) => (
              <li key={r.key} className="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tabular-nums">{r.country} {r.postalCode}{r.city ? <span className="font-normal text-gray-500"> · {r.city}</span> : null}</p>
                    <p className="text-2xs text-gray-400">{r.profileName}{r.zoneCode ? ` · ${r.zoneCode}` : ''}</p>
                  </div>
                  <span className={`shrink-0 text-2xs font-semibold px-1.5 py-0.5 rounded ${STATUS_CLS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </div>
                <div className="mt-2"><Progress row={r} /></div>
                <p className="mt-1 text-2xs text-gray-500">
                  Devis : {formatCost(r)} · Dernier devis valide : {r.lastValidQuoteAt ? new Date(r.lastValidQuoteAt).toLocaleDateString('fr-FR') : '—'}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
