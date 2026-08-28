'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconAdjustmentsHorizontal, IconAlertTriangle, IconMinus, IconPlus, IconX } from '@tabler/icons-react';

type Adjustment = { id: string; previous_capacity: number; new_capacity: number; delta: number; reason: string | null; actor_name: string; created_at: string };

export default function EventCapacityManager({ eventId, capacityTotal, capacityRemaining }: { eventId: string; capacityTotal: number; capacityRemaining: number }) {
  const reservedPlaces = Math.max(0, capacityTotal - capacityRemaining);
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [newCapacity, setNewCapacity] = useState(capacityTotal);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [history, setHistory] = useState<Adjustment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const delta = newCapacity - capacityTotal;
  const invalid = !Number.isInteger(newCapacity) || newCapacity < reservedPlaces;
  const impactLabel = useMemo(() => delta > 0 ? `+${delta} place${delta > 1 ? 's' : ''} disponible${delta > 1 ? 's' : ''}` : delta < 0 ? `${Math.abs(delta)} place${Math.abs(delta) > 1 ? 's' : ''} retirée${Math.abs(delta) > 1 ? 's' : ''}` : 'Aucun changement', [delta]);

  async function loadCapacity() {
    const response = await fetch(`/api/admin/evenementiel/events/${eventId}/capacity`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 403) { setAllowed(false); return; }
    if (!response.ok) throw new Error(payload.error ?? 'Impossible de charger l’historique.');
    setAllowed(true);
    setHistory(payload.adjustments ?? []);
  }

  useEffect(() => { void loadCapacity().catch(() => setAllowed(false)); }, [eventId]);

  async function openDialog() {
    setOpen(true); setNewCapacity(capacityTotal); setReason(''); setError(null); setLoadingHistory(true);
    try { await loadCapacity(); } catch (err) { setError(err instanceof Error ? err.message : 'Impossible de charger l’historique.'); }
    finally { setLoadingHistory(false); }
  }

  async function save() {
    if (invalid || delta === 0 || saving) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/admin/evenementiel/events/${eventId}/capacity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capacity_total: newCapacity, reason }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setError(payload.error ?? 'Impossible de modifier la capacité.'); return; }
      window.location.reload();
    } catch { setError('Erreur réseau lors de la modification de la capacité.'); }
    finally { setSaving(false); }
  }

  if (!allowed) return null;

  return <>
    <button type="button" onClick={openDialog} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"><IconAdjustmentsHorizontal size={15} /> Gérer la capacité</button>
    {open && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 sm:items-center sm:p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="capacity-dialog-title" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-gray-200 bg-white shadow-2xl sm:max-w-xl sm:rounded-2xl dark:border-gray-700 dark:bg-gray-900">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-100 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-900"><div><h2 id="capacity-dialog-title" className="text-base font-semibold text-gray-950 dark:text-white">Gérer la capacité</h2><p className="mt-1 text-xs text-gray-500">Les places déjà réservées restent toujours protégées.</p></div><button type="button" onClick={() => setOpen(false)} disabled={saving} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-gray-500 hover:bg-gray-50" aria-label="Fermer"><IconX size={18} /></button></div>
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-gray-50 p-3 text-center dark:bg-gray-950">{[['Capacité', capacityTotal], ['Réservées', reservedPlaces], ['Disponibles', capacityRemaining]].map(([label, value]) => <div key={String(label)}><p className="text-2xs uppercase tracking-wide text-gray-400">{label}</p><p className="mt-1 text-lg font-semibold text-gray-950 dark:text-white">{value}</p></div>)}</div>
          <div><label htmlFor="capacity-total" className="text-sm font-semibold text-gray-900 dark:text-gray-100">Nouvelle capacité</label><div className="mt-2 grid grid-cols-[44px_minmax(0,1fr)_44px] gap-2"><button type="button" onClick={() => setNewCapacity(v => Math.max(reservedPlaces, v - 1))} className="grid min-h-11 place-items-center rounded-lg border border-gray-200"><IconMinus size={17} /></button><input id="capacity-total" type="number" min={reservedPlaces} step="1" value={newCapacity} onChange={e => setNewCapacity(Number(e.target.value))} className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-center text-base font-semibold dark:border-gray-700 dark:bg-gray-950" /><button type="button" onClick={() => setNewCapacity(v => v + 1)} className="grid min-h-11 place-items-center rounded-lg border border-gray-200"><IconPlus size={17} /></button></div>{invalid ? <p className="mt-2 flex gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"><IconAlertTriangle size={14} /> La capacité ne peut pas être inférieure aux {reservedPlaces} places déjà réservées.</p> : <p className="mt-2 text-xs font-medium text-gray-500">{impactLabel}</p>}</div>
          <div><label htmlFor="capacity-reason" className="text-sm font-semibold text-gray-900 dark:text-gray-100">Motif <span className="font-normal text-gray-400">(optionnel)</span></label><input id="capacity-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="Ex. ajout de tables" className="mt-2 min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-950" /></div>
          <div className="border-t border-gray-100 pt-4 dark:border-gray-800"><h3 className="text-sm font-semibold">Dernières modifications</h3>{loadingHistory ? <p className="mt-2 text-xs text-gray-400">Chargement…</p> : history.length === 0 ? <p className="mt-2 text-xs text-gray-400">Aucune modification enregistrée.</p> : <div className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-800 dark:border-gray-800">{history.slice(0,5).map(item => <div key={item.id} className="px-3 py-2.5"><div className="flex justify-between gap-3"><span className="text-xs font-semibold">{item.delta > 0 ? `+${item.delta}` : item.delta} places · {item.previous_capacity} → {item.new_capacity}</span><span className="text-2xs text-gray-400">{new Date(item.created_at).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'})}</span></div><p className="mt-1 text-2xs text-gray-500">{item.reason || 'Sans motif'} · {item.actor_name}</p></div>)}</div>}</div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        </div>
        <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-gray-100 bg-white px-5 py-4 sm:flex-row sm:justify-end dark:border-gray-800 dark:bg-gray-900"><button type="button" onClick={() => setOpen(false)} disabled={saving} className="min-h-11 rounded-lg border border-gray-200 px-4 text-sm font-semibold">Annuler</button><button type="button" onClick={save} disabled={saving || invalid || delta === 0} className="min-h-11 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Mise à jour…' : 'Mettre à jour'}</button></div>
      </div>
    </div>}
  </>;
}
