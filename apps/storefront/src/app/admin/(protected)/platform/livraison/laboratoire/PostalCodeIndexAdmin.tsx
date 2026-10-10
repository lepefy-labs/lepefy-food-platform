'use client';

import { useState } from 'react';

// Mêmes pays que le reste du Laboratoire (ALLOWED_COUNTRIES côté route,
// IMPORTABLE_COUNTRIES côté import) — dupliqué ici pour ne pas importer un
// module serveur (unzip.ts utilise node:zlib) dans un composant client.
const COUNTRIES = [
  { value: 'IT', label: 'Italie' },
  { value: 'FR', label: 'France' },
  { value: 'DE', label: 'Allemagne' },
  { value: 'BE', label: 'Belgique' },
  { value: 'CH', label: 'Suisse' },
];

type CountryStatus = 'pending' | 'running' | 'done' | 'error';

interface CountryResult {
  status: CountryStatus;
  rowCount?: number;
  error?: string;
}

export function PostalCodeIndexAdmin() {
  const [selected, setSelected] = useState<string[]>(['IT']);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<Record<string, CountryResult>>({});

  async function handleImport() {
    if (selected.length === 0) return;
    setImporting(true);
    setResults(Object.fromEntries(selected.map((c) => [c, { status: 'pending' as const }])));

    for (const country of selected) {
      setResults((prev) => ({ ...prev, [country]: { status: 'running' } }));
      try {
        const res = await fetch('/api/admin/shipping-postal-code-import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ country }),
        });
        const data = await res.json() as { rowCount?: number; error?: string };
        if (!res.ok) throw new Error(data.error ?? 'Erreur');
        setResults((prev) => ({ ...prev, [country]: { status: 'done', rowCount: data.rowCount } }));
      } catch (err) {
        setResults((prev) => ({
          ...prev,
          [country]: { status: 'error', error: err instanceof Error ? err.message : 'Erreur' },
        }));
      }
    }

    setImporting(false);
  }

  return (
    <section className="bg-a-surface rounded-xl border border-a-border p-5">
      <h2 className="text-sm font-semibold text-a-text mb-1">Base de données des codes postaux</h2>
      <p className="text-xs text-a-text-3 mb-4">
        Importe les codes postaux depuis GeoNames pour que la recherche de ville dans les campagnes fonctionne sans appel externe à chaque utilisation.
        À relancer occasionnellement pour rafraîchir les données ; sans effet sur les campagnes déjà lancées.
      </p>

      <label className="text-a-text-3 text-xs uppercase tracking-wide mb-1 block">Pays à importer</label>
      <select
        multiple
        disabled={importing}
        value={selected}
        onChange={(e) => setSelected(Array.from(e.target.selectedOptions, (o) => o.value))}
        className="w-full sm:w-64 h-32 border border-a-border rounded-lg px-2 py-1 text-sm bg-a-surface text-a-text focus:outline-none focus:ring-2 focus:ring-a-focus disabled:opacity-50"
      >
        {COUNTRIES.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
      <p className="text-xs text-a-text-3 mt-1 mb-3">Ctrl/Cmd + clic pour sélectionner plusieurs pays.</p>

      <button
        onClick={() => void handleImport()}
        disabled={importing || selected.length === 0}
        className="min-h-11 px-4 py-2 text-xs rounded-lg text-a-on-brand bg-a-brand disabled:opacity-50"
      >
        {importing ? 'Import en cours…' : `Importer ${selected.length || ''} pays`.trim()}
      </button>

      {Object.keys(results).length > 0 && (
        <div className="mt-4 space-y-1.5">
          {Object.entries(results).map(([country, result]) => (
            <div key={country} className="flex items-center gap-2 text-sm">
              <span className="w-10 font-medium text-a-text-2">{country}</span>
              {result.status === 'pending' && <span className="text-a-text-3">En attente…</span>}
              {result.status === 'running' && <span className="text-tone-info-fg">Import en cours…</span>}
              {result.status === 'done' && <span className="text-tone-success-fg">{result.rowCount?.toLocaleString('fr-FR')} codes postaux importés</span>}
              {result.status === 'error' && <span className="text-tone-danger-fg">Échec — {result.error}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
