'use client';

import { useState, Fragment } from 'react';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import type { ShippingPackagingProfileRow } from '@lepefy/types';
import ConfirmActionModal from '../../../_components/ui/ConfirmActionModal';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

interface FormState {
  name: string;
  box_length_cm: string;
  box_width_cm: string;
  box_height_cm: string;
  max_weight_g: string;
  is_default: boolean;
  active: boolean;
}

function toFormState(profile?: ShippingPackagingProfileRow): FormState {
  return {
    name: profile?.name ?? '',
    box_length_cm: profile ? String(profile.box_length_cm) : '',
    box_width_cm: profile ? String(profile.box_width_cm) : '',
    box_height_cm: profile ? String(profile.box_height_cm) : '',
    max_weight_g: profile ? String(profile.max_weight_g) : '',
    is_default: profile?.is_default ?? false,
    active: profile?.active ?? true,
  };
}

function formToBody(form: FormState) {
  return {
    name: form.name.trim(),
    box_length_cm: Number(form.box_length_cm),
    box_width_cm: Number(form.box_width_cm),
    box_height_cm: Number(form.box_height_cm),
    max_weight_g: Number(form.max_weight_g),
    is_default: form.is_default,
    active: form.active,
  };
}

function validate(form: FormState): string | null {
  if (!form.name.trim()) return 'Indiquez un nom (ex. « Moyen »).';
  const dims = [form.box_length_cm, form.box_width_cm, form.box_height_cm, form.max_weight_g];
  if (dims.some((v) => !v || Number(v) <= 0)) return 'Toutes les dimensions et le poids max doivent être positifs.';
  return null;
}

function ProfileForm({
  initial, submitLabel, isSaving, onSubmit, onCancel,
}: {
  initial?: ShippingPackagingProfileRow;
  submitLabel: string;
  isSaving: boolean;
  onSubmit: (form: FormState) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<FormState>(toFormState(initial));
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    const validationError = validate(form);
    if (validationError) { setError(validationError); return; }
    setError(null);
    onSubmit(form);
  }

  return (
    <div className="space-y-3">
      {error && <div className="px-3 py-2 rounded-lg text-xs bg-red-50 text-red-700">{error}</div>}
      <div>
        <label className={LABEL_CLS}>Nom</label>
        <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex. Moyen" className={INPUT_CLS} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className={LABEL_CLS}>Longueur (cm)</label><input type="number" min={1} value={form.box_length_cm} onChange={(e) => set('box_length_cm', e.target.value)} className={INPUT_CLS} /></div>
        <div><label className={LABEL_CLS}>Largeur (cm)</label><input type="number" min={1} value={form.box_width_cm} onChange={(e) => set('box_width_cm', e.target.value)} className={INPUT_CLS} /></div>
        <div><label className={LABEL_CLS}>Hauteur (cm)</label><input type="number" min={1} value={form.box_height_cm} onChange={(e) => set('box_height_cm', e.target.value)} className={INPUT_CLS} /></div>
      </div>
      <div>
        <label className={LABEL_CLS}>Poids maximum (g)</label>
        <input type="number" min={1} value={form.max_weight_g} onChange={(e) => set('max_weight_g', e.target.value)} placeholder="Ex. 10000 pour 10 kg" className={INPUT_CLS} />
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={form.is_default} onChange={(e) => set('is_default', e.target.checked)} className="w-5 h-5" />
          Profil par défaut
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="w-5 h-5" />
          Actif
        </label>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button onClick={handleSubmit} disabled={isSaving} className="min-h-11 px-4 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50">{submitLabel}</button>
        {onCancel && <button onClick={onCancel} disabled={isSaving} className="min-h-11 px-4 py-2 text-xs rounded-lg border border-gray-200 text-gray-500 disabled:opacity-50">Annuler</button>}
      </div>
    </div>
  );
}

export function PackagingProfilesSection({ initialProfiles }: { initialProfiles: ShippingPackagingProfileRow[] }) {
  const [profiles, setProfiles] = useState<ShippingPackagingProfileRow[]>([...initialProfiles].sort((a, b) => a.position - b.position));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
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
      const res = await fetch('/api/admin/shipping-packaging-profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formToBody(form)) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erreur');
      setProfiles((prev) => {
        const next = form.is_default ? prev.map((p) => ({ ...p, is_default: false })) : prev;
        return [...next, data as ShippingPackagingProfileRow].sort((a, b) => a.position - b.position);
      });
      setCreating(false);
      showToast('Profil ajouté', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la création', 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function patchProfile(id: string, payload: object): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/shipping-packaging-profiles/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erreur');
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Erreur lors de l'enregistrement", 'error');
      return false;
    }
  }

  async function handleUpdate(id: string, form: FormState) {
    setSavingId(id);
    const body = formToBody(form);
    const ok = await patchProfile(id, body);
    if (ok) {
      setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, ...body } : (body.is_default ? { ...p, is_default: false } : p))));
      setEditingId(null);
      showToast('Enregistré', 'success');
    }
    setSavingId(null);
  }

  async function handleDelete(id: string) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/shipping-packaging-profiles/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erreur');
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      setPendingDeleteId(null);
      showToast('Profil supprimé', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la suppression', 'error');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      {toast && <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{toast.msg}</div>}

      {profiles.length === 0 && !creating && (
        <p className="text-sm text-gray-400 mb-4">
          Aucun profil configuré — ajoutez au moins une boîte pour utiliser le laboratoire de simulation et l&apos;assistant expédition.
        </p>
      )}

      {profiles.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {profiles.map((profile) => (
            <Fragment key={profile.id}>
              <div className={`rounded-xl border p-4 ${profile.is_default ? 'border-[var(--color-primary)]' : 'border-gray-200 dark:border-gray-800'}`}>
                <div className="flex items-start justify-between mb-1">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{profile.name}</p>
                  {profile.is_default && <span className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]">Défaut</span>}
                </div>
                <p className="text-xs text-gray-500 mb-0.5">{profile.box_length_cm} × {profile.box_width_cm} × {profile.box_height_cm} cm</p>
                <p className="text-xs text-gray-400">≤ {(profile.max_weight_g / 1000).toLocaleString('fr-FR')} kg{!profile.active && ' · inactif'}</p>
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={() => setEditingId(editingId === profile.id ? null : profile.id)} className="min-h-8 px-3 py-1.5 text-xs rounded-lg border border-gray-200">{editingId === profile.id ? 'Fermer' : 'Modifier'}</button>
                  <button onClick={() => setPendingDeleteId(profile.id)} disabled={savingId === profile.id} className="min-h-8 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-red-600 flex items-center gap-1 disabled:opacity-50"><IconTrash size={14} stroke={1.5} /></button>
                </div>
                {editingId === profile.id && (
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                    <ProfileForm initial={profile} submitLabel="Enregistrer" isSaving={savingId === profile.id} onSubmit={(form) => handleUpdate(profile.id, form)} onCancel={() => setEditingId(null)} />
                  </div>
                )}
              </div>
            </Fragment>
          ))}
        </div>
      )}

      {creating ? (
        <div className="border border-dashed border-gray-200 rounded-lg p-4"><p className="text-xs font-medium text-gray-500 mb-3">Nouveau profil</p><ProfileForm submitLabel="Ajouter" isSaving={savingId === 'new'} onSubmit={handleCreate} onCancel={() => setCreating(false)} /></div>
      ) : (
        <button onClick={() => setCreating(true)} className="min-h-11 flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)]"><IconPlus size={14} stroke={1.5} />Ajouter un profil</button>
      )}

      <ConfirmActionModal
        open={pendingDeleteId !== null}
        title="Supprimer ce profil d'emballage ?"
        description="Ce profil sera supprimé définitivement. Les observations passées qui l'utilisaient sont conservées."
        confirmLabel="Supprimer le profil"
        cancelLabel="Conserver"
        destructive
        loading={pendingDeleteId !== null && savingId === pendingDeleteId}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => { if (pendingDeleteId) void handleDelete(pendingDeleteId); }}
      />
    </section>
  );
}
