'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconAdjustmentsHorizontal, IconAlertTriangle, IconMinus, IconPlus } from '@tabler/icons-react';
import Button from '@/app/admin/_components/ui/Button';
import Dialog from '@/app/admin/_components/ui/Dialog';

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
    <button type="button" onClick={openDialog} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-a-border px-3 text-xs font-semibold text-a-text-2 hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus"><IconAdjustmentsHorizontal size={15} /> Gérer la capacité</button>
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      dismissible={!saving}
      title="Gérer la capacité"
      description="Les places déjà réservées restent toujours protégées."
      footer={<>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Annuler</Button>
        <Button onClick={save} loading={saving} disabled={invalid || delta === 0}>Mettre à jour</Button>
      </>}
    >
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-a-surface-2 p-3 text-center">{[['Capacité', capacityTotal], ['Réservées', reservedPlaces], ['Disponibles', capacityRemaining]].map(([label, value]) => <div key={String(label)}><p className="text-xs uppercase tracking-wide text-a-text-3">{label}</p><p className="mt-1 text-lg font-semibold text-a-text">{value}</p></div>)}</div>
          <div><label htmlFor="capacity-total" className="text-sm font-semibold text-a-text">Nouvelle capacité</label><div className="mt-2 grid grid-cols-[44px_minmax(0,1fr)_44px] gap-2"><button type="button" onClick={() => setNewCapacity(v => Math.max(reservedPlaces, v - 1))} className="grid min-h-11 place-items-center rounded-lg border border-a-border"><IconMinus size={17} /></button><input id="capacity-total" type="number" min={reservedPlaces} step="1" value={newCapacity} onChange={e => setNewCapacity(Number(e.target.value))} className="min-h-11 w-full rounded-lg border border-a-border bg-a-surface px-3 text-center text-base font-semibold" /><button type="button" onClick={() => setNewCapacity(v => v + 1)} className="grid min-h-11 place-items-center rounded-lg border border-a-border"><IconPlus size={17} /></button></div>{invalid ? <p className="mt-2 flex gap-1.5 rounded-lg bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg"><IconAlertTriangle size={14} /> La capacité ne peut pas être inférieure aux {reservedPlaces} places déjà réservées.</p> : <p className="mt-2 text-xs font-medium text-a-text-3">{impactLabel}</p>}</div>
          <div><label htmlFor="capacity-reason" className="text-sm font-semibold text-a-text">Motif <span className="font-normal text-a-text-3">(optionnel)</span></label><input id="capacity-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="Ex. ajout de tables" className="mt-2 min-h-11 w-full rounded-lg border border-a-border bg-a-surface px-3 text-sm" /></div>
          <div className="border-t border-a-border pt-4"><h3 className="text-sm font-semibold">Dernières modifications</h3>{loadingHistory ? <p className="mt-2 text-xs text-a-text-3">Chargement…</p> : history.length === 0 ? <p className="mt-2 text-xs text-a-text-3">Aucune modification enregistrée.</p> : <div className="mt-2 divide-y divide-a-border rounded-lg border border-a-border">{history.slice(0,5).map(item => <div key={item.id} className="px-3 py-2.5"><div className="flex justify-between gap-3"><span className="text-xs font-semibold">{item.delta > 0 ? `+${item.delta}` : item.delta} places · {item.previous_capacity} → {item.new_capacity}</span><span className="text-xs text-a-text-3">{new Date(item.created_at).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'})}</span></div><p className="mt-1 text-xs text-a-text-3">{item.reason || 'Sans motif'} · {item.actor_name}</p></div>)}</div>}</div>
          {error && <p className="rounded-lg bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg">{error}</p>}
        </div>
    </Dialog>
  </>;
}
