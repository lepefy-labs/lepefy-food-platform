'use client';

import { useState } from 'react';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import type { ShippingZoneRow } from '@lepefy/types';
import ConfirmActionModal from '../../_components/ui/ConfirmActionModal';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

interface FormState {
  code: string;
  country: string;
  postal_prefixes: string;
}

function toFormState(zone?: ShippingZoneRow): FormState {
  return {
    code: zone?.code ?? '',
    country: zone?.country ?? '',
    postal_prefixes: zone?.postal_prefixes.join(', ') ?? '',
  };
}

function formToBody(form: FormState) {
  return {
    code: form.code.trim(),
    country: form.country.trim().toUpperCase(),
    postal_prefixes: form.postal_prefixes.split(',').map((p) => p.trim()).filter(Boolean),
  };
}

function ZoneForm({ initial, submitLabel, isSaving, onSubmit, onCancel }: {
  initial?: ShippingZoneRow; submitLabel: string; isSaving: boolean;
  onSubmit: (form: FormState) => void; onCancel?: () => void;
}) {
  const [form, setForm] = useState<FormState>(toFormState(initial));
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    if (!form.code.trim() || !/^[A-Za-z]{2}$/.test(form.country.trim())) {
      setError('Code de zone et pays (2 lettres) requis.');
      return;
    }
    setError(null);
    onSubmit(form);
  }

  return (
    <div className="space-y-3">
      {error && <div className="px-3 py-2 rounded-lg text-xs bg-red-50 text-red-700">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div><label className={LABEL_CLS}>Code de zone</label><input type="text" value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="Ex. IT_SICILY" className={INPUT_CLS} /></div>
        <div><label className={LABEL_CLS}>Pays (ISO2)</label><input type="text" value={form.country} onChange={(e) => set('country', e.target.value)} placeholder="IT" className={INPUT_CLS} /></div>
      </div>
      <div>
        <label className={LABEL_CLS}>Préfixes de code postal (séparés par des virgules)</label>
        <input type="text" value={form.postal_prefixes} onChange={(e) => set('postal_prefixes', e.target.value)} placeholder="90, 91, 92, 93, 94, 95, 96, 97, 98" className={INPUT_CLS} />
        <p className="text-xs text-gray-400 mt-1">Saisie manuelle — aucun mapping code postal → région n&apos;est fourni par la plateforme.</p>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button onClick={handleSubmit} disabled={isSaving} className="min-h-11 px-4 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50">{submitLabel}</button>
        {onCancel && <button onClick={onCancel} disabled={isSaving} className="min-h-11 px-4 py-2 text-xs rounded-lg border border-gray-200 text-gray-500 disabled:opacity-50">Annuler</button>}
      </div>
    </div>
  );
}

export function ZonesSection({ initialZones }: { initialZones: ShippingZoneRow[] }) {
  const [zones, setZones] = useState<ShippingZoneRow[]>([...initialZones].sort((a, b) => a.position - b.position));
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleCreate(form: FormState) {
    setSavingId('new');
    try {
      const res = await fetch('/api/admin/shipping-zones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formToBody(form)) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erreur');
      setZones((prev) => [...prev, data as ShippingZoneRow]);
      setCreating(false);
      showToast('Zone ajoutée', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la création', 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function handleUpdate(id: string, form: FormState) {
    setSavingId(id);
    try {
      const body = formToBody(form);
      const res = await fetch(`/api/admin/shipping-zones/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erreur');
      setZones((prev) => prev.map((z) => (z.id === id ? { ...z, ...body } : z)));
      setEditingId(null);
      showToast('Enregistré', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Erreur lors de l'enregistrement", 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/shipping-zones/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setZones((prev) => prev.filter((z) => z.id !== id));
      setPendingDeleteId(null);
      showToast('Zone supprimée', 'success');
    } catch {
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 mt-4">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Zones géographiques</h2>
      <p className="text-xs text-gray-400 mb-4">Utilisées par l&apos;assistant expédition et le laboratoire pour regrouper les destinations (ex. îles, régions à surcharge).</p>

      {toast && <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{toast.msg}</div>}

      {zones.length === 0 && !creating && <p className="text-sm text-gray-400 mb-4">Aucune zone définie — les destinations sont regroupées par pays uniquement.</p>}

      {zones.length > 0 && (
        <div className="space-y-2 mb-4">
          {zones.map((zone) => (
            <div key={zone.id} className="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{zone.code}</span>
                  <span className="text-xs text-gray-400 ml-2">{zone.country} · préfixes {zone.postal_prefixes.join(', ') || '—'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditingId(editingId === zone.id ? null : zone.id)} className="min-h-8 px-3 py-1.5 text-xs rounded-lg border border-gray-200">{editingId === zone.id ? 'Fermer' : 'Modifier'}</button>
                  <button onClick={() => setPendingDeleteId(zone.id)} disabled={savingId === zone.id} className="min-h-8 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-red-600 flex items-center gap-1 disabled:opacity-50"><IconTrash size={14} stroke={1.5} /></button>
                </div>
              </div>
              {editingId === zone.id && (
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <ZoneForm initial={zone} submitLabel="Enregistrer" isSaving={savingId === zone.id} onSubmit={(form) => handleUpdate(zone.id, form)} onCancel={() => setEditingId(null)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {creating ? (
        <div className="border border-dashed border-gray-200 rounded-lg p-4"><p className="text-xs font-medium text-gray-500 mb-3">Nouvelle zone</p><ZoneForm submitLabel="Ajouter" isSaving={savingId === 'new'} onSubmit={handleCreate} onCancel={() => setCreating(false)} /></div>
      ) : (
        <button onClick={() => setCreating(true)} className="min-h-11 flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)]"><IconPlus size={14} stroke={1.5} />Ajouter une zone</button>
      )}

      <ConfirmActionModal
        open={pendingDeleteId !== null}
        title="Supprimer cette zone ?"
        description="Les observations passées liées à cette zone conservent leur code de zone historique."
        confirmLabel="Supprimer la zone"
        cancelLabel="Conserver"
        destructive
        loading={pendingDeleteId !== null && savingId === pendingDeleteId}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => { if (pendingDeleteId) void handleDelete(pendingDeleteId); }}
      />
    </section>
  );
}
