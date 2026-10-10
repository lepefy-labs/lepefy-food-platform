'use client';

import { useRef, useState } from 'react';
import { IconDownload } from '@tabler/icons-react';
import type { GestionExportType } from '@/lib/gestion/exportData';

const OPTIONS: { type: GestionExportType; label: string }[] = [
  { type: 'full', label: 'Situation complète' },
  { type: 'suppliers', label: 'Fournisseurs' },
  { type: 'purchases', label: 'Achats' },
  { type: 'treasury', label: 'Trésorerie' },
  { type: 'stock', label: 'Stock' },
];

export default function ExportExcelButton({ allowed }: { allowed: GestionExportType[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [type, setType] = useState<GestionExportType>(allowed[0] ?? 'full');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!allowed.length) return null;

  async function download() {
    if (from && to && from > to) { setError('La date de début doit précéder la date de fin.'); return; }
    setBusy(true); setError('');
    try {
      const query = new URLSearchParams();
      if (from) query.set('from', from);
      if (to) query.set('to', to);
      const response = await fetch(`/api/admin/gestion/export/${type}${query.size ? `?${query}` : ''}`, { cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Le téléchargement a échoué.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'lepefy-gestion.xlsx';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      dialog.current?.close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Le téléchargement a échoué.');
    } finally { setBusy(false); }
  }

  return <>
    <button type="button" onClick={() => dialog.current?.showModal()}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-a-border bg-a-surface px-4 py-2 text-sm font-medium text-a-text shadow-sm hover:bg-a-surface-2">
      <IconDownload size={18} aria-hidden="true" />Exporter Excel
    </button>
    <dialog ref={dialog} aria-label="Exporter Excel" className="w-[calc(100%-2rem)] max-w-md rounded-2xl border border-a-border bg-a-surface p-0 text-a-text shadow-2xl backdrop:bg-black/50">
      <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Exporter Excel</h2>
        <p className="mt-1 text-sm text-a-text-3">Photographie des données Gestion à consulter hors ligne.</p>
        <fieldset className="mt-5 space-y-2">
          <legend className="mb-2 text-sm font-medium">Contenu</legend>
          {OPTIONS.filter((option) => allowed.includes(option.type)).map((option) =>
            <label key={option.type} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-a-border px-3 py-2 text-sm">
              <input type="radio" name="gestion-export-type" value={option.type} checked={type === option.type} onChange={() => setType(option.type)} />
              {option.label}
            </label>)}
        </fieldset>
        <fieldset className="mt-5">
          <legend className="text-sm font-medium">Période personnalisée</legend>
          <p className="mt-1 text-xs text-a-text-3">Les fournisseurs et le stock actuel restent des données du jour.</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">Du<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-a-border-strong bg-a-surface p-2" /></label>
            <label className="text-sm">Au<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-a-border-strong bg-a-surface p-2" /></label>
          </div>
        </fieldset>
        {error && <p role="alert" className="mt-3 text-sm text-tone-danger-fg">{error}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => dialog.current?.close()} className="rounded-lg border border-a-border-strong px-4 py-2 text-sm">Annuler</button>
          <button type="button" disabled={busy} onClick={download} className="rounded-lg bg-a-inverse px-4 py-2 text-sm font-medium text-a-on-inverse disabled:opacity-50">
            {busy ? 'Préparation...' : 'Télécharger .xlsx'}
          </button>
        </div>
      </div>
    </dialog>
  </>;
}
