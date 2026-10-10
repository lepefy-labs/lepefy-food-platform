'use client';

import { useState } from 'react';
import { IconTrash, IconPlus, IconAlertTriangle, IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import type { ShippingZoneRow } from '@lepefy/types';
import ConfirmDialog from '../../_components/ui/ConfirmDialog';
import {
  countryName,
  duplicatePrefixes,
  explainZoneMatch,
  findZonePrefixConflicts,
  groupZonesByCountry,
} from '@/lib/shipping/shippingRuleConflicts';

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

function ZoneForm({ initial, allZones, submitLabel, isSaving, onSubmit, onCancel }: {
  initial?: ShippingZoneRow; allZones: ShippingZoneRow[]; submitLabel: string; isSaving: boolean;
  onSubmit: (form: FormState) => void; onCancel?: () => void;
}) {
  const [form, setForm] = useState<FormState>(toFormState(initial));
  const [error, setError] = useState<string | null>(null);

  const body = formToBody(form);
  // The API rejects these too; warn while typing.
  const duplicates = /^[A-Z]{2}$/.test(body.country)
    ? duplicatePrefixes({ id: initial?.id, country: body.country, postal_prefixes: body.postal_prefixes, active: initial?.active ?? true }, allZones)
    : [];

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    if (!form.code.trim() || !/^[A-Za-z]{2}$/.test(form.country.trim())) {
      setError('Code de zone et pays (2 lettres) requis.');
      return;
    }
    if (duplicates.length > 0) {
      setError(`Préfixe(s) déjà utilisé(s) par une autre zone active de ce pays : ${duplicates.join(', ')}.`);
      return;
    }
    setError(null);
    onSubmit(form);
  }

  return (
    <div className="space-y-3">
      {error && <div role="alert" className="px-3 py-2 rounded-lg text-xs bg-red-50 text-red-700">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div><label className={LABEL_CLS}>Code de zone</label><input type="text" value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="Ex. IT_SICILY" className={INPUT_CLS} /></div>
        <div><label className={LABEL_CLS}>Pays (ISO2)</label><input type="text" value={form.country} onChange={(e) => set('country', e.target.value)} placeholder="IT" className={INPUT_CLS} /></div>
      </div>
      <div>
        <label className={LABEL_CLS}>Préfixes de code postal (séparés par des virgules)</label>
        <input type="text" value={form.postal_prefixes} onChange={(e) => set('postal_prefixes', e.target.value)} placeholder="90, 91, 92, 93, 94, 95, 96, 97, 98" className={INPUT_CLS} />
        <p className="text-xs text-gray-400 mt-1">Saisie manuelle — aucun mapping code postal → région n&apos;est fourni par la plateforme. Un préfixe plus long (30121) est prioritaire sur un plus court (30).</p>
      </div>
      {duplicates.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <IconAlertTriangle size={14} stroke={1.8} className="mt-0.5 shrink-0" />
          Préfixe(s) déjà utilisé(s) par une autre zone active de ce pays : {duplicates.join(', ')}.
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={handleSubmit} disabled={isSaving} className="min-h-11 px-4 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50">{submitLabel}</button>
        {onCancel && <button onClick={onCancel} disabled={isSaving} className="min-h-11 px-4 py-2 text-xs rounded-lg border border-gray-200 text-gray-500 disabled:opacity-50">Annuler</button>}
      </div>
    </div>
  );
}

export function ZonesSection({ initialZones, canManage, tariffMode }: {
  initialZones: ShippingZoneRow[];
  /** UI hint only: the API re-checks shipping.manage. */
  canManage: boolean;
  /** Tenant prices from the tariff grid: the zone decides the customer price. */
  tariffMode: boolean;
}) {
  const [zones, setZones] = useState<ShippingZoneRow[]>([...initialZones].sort((a, b) => a.position - b.position));
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [openCountries, setOpenCountries] = useState<Set<string>>(new Set());
  const [lookupCountry, setLookupCountry] = useState(() => initialZones[0]?.country.toUpperCase() ?? 'IT');
  const [lookupPostal, setLookupPostal] = useState('');

  const groups = groupZonesByCountry(zones);
  const prefixConflicts = findZonePrefixConflicts(zones);
  const lookup = lookupPostal.trim() ? explainZoneMatch(zones, lookupCountry, lookupPostal) : null;
  const countryOptions = groups.map((group) => group.country);

  function toggleCountry(country: string) {
    setOpenCountries((previous) => {
      const next = new Set(previous);
      if (next.has(country)) next.delete(country); else next.add(country);
      return next;
    });
  }

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
      setOpenCountries((previous) => new Set(previous).add((data as ShippingZoneRow).country.toUpperCase()));
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
      setZones((prev) => prev.map((z) => (z.id === id ? { ...z, ...body, code: body.code.toUpperCase().replace(/\s+/g, '_') } : z)));
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
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {tariffMode
          ? <>En mode grille tarifaire, la zone détermine le prix client : un code postal hors de toute zone n&apos;est pas couvert par le forfait et suit le repli configuré. </>
          : <>Utilisées par la grille tarifaire (si elle est activée), l&apos;assistant expédition et le laboratoire. </>}
        Le préfixe le plus long l&apos;emporte.
      </p>

      {toast && <div role={toast.type === 'error' ? 'alert' : 'status'} className={`mb-4 px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{toast.msg}</div>}

      {prefixConflicts.length > 0 && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <IconAlertTriangle size={14} stroke={1.8} className="mt-0.5 shrink-0" />
          <span>
            Préfixes en conflit (zone ambiguë) : {prefixConflicts.map((conflict) => `${conflict.country} ${conflict.prefix} → ${conflict.zoneCodes.join(' / ')}`).join(' · ')}
          </span>
        </div>
      )}

      {zones.length > 0 && (
        <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/40">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <label htmlFor="zone-lookup-postal" className="font-semibold">Quelle zone pour</label>
            <select aria-label="Pays" value={lookupCountry} onChange={(e) => setLookupCountry(e.target.value)} className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900">
              {countryOptions.map((country) => <option key={country} value={country}>{countryName(country)}</option>)}
            </select>
            <input id="zone-lookup-postal" type="text" inputMode="numeric" autoComplete="off" value={lookupPostal} onChange={(e) => setLookupPostal(e.target.value)} placeholder="Code postal" className="w-28 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900" />
            <span aria-live="polite">
              {lookup && (lookup.zoneCode ? (
                <>
                  → <strong className="font-semibold text-gray-900 dark:text-gray-100">{lookup.zoneCode}</strong>
                  <span className="text-gray-500"> (préfixe {lookup.matchedPrefix}{lookup.overridden.length > 0 && `, prioritaire sur ${lookup.overridden.map((match) => `${match.prefix} · ${match.zoneCode}`).join(', ')}`})</span>
                </>
              ) : (
                <span className="text-amber-700">→ Aucune zone{tariffMode ? ' : non couvert par le forfait' : ''}</span>
              ))}
            </span>
          </div>
        </div>
      )}

      {zones.length === 0 && !creating && <p className="text-sm text-gray-400 mb-4">Aucune zone définie — les destinations sont regroupées par pays uniquement.</p>}

      {groups.length > 0 && (
        <div className="mb-4 divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
          {groups.map((group) => {
            const open = openCountries.has(group.country);
            return (
              <div key={group.country}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggleCountry(group.country)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                    {open ? <IconChevronDown size={16} stroke={1.8} /> : <IconChevronRight size={16} stroke={1.8} />}
                    {countryName(group.country)}
                    <span className="text-xs font-normal text-gray-400">{group.zones.length} zone{group.zones.length !== 1 ? 's' : ''}</span>
                  </span>
                  {!open && <span className="min-w-0 truncate text-xs text-gray-400">{group.zones.map((zone) => zone.code).join(' · ')}</span>}
                </button>
                {open && (
                  <div className="space-y-2 px-3 pb-3">
                    {group.zones.map((zone) => (
                      <div key={zone.id} className="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{zone.code}</span>
                            {!zone.active && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-2xs font-semibold text-gray-500">Inactive</span>}
                            <p className="mt-0.5 break-words text-xs text-gray-400">préfixes {zone.postal_prefixes.join(', ') || '—'}</p>
                          </div>
                          {canManage && (
                            <div className="flex shrink-0 items-center gap-2">
                              <button onClick={() => setEditingId(editingId === zone.id ? null : zone.id)} className="min-h-8 px-3 py-1.5 text-xs rounded-lg border border-gray-200">{editingId === zone.id ? 'Fermer' : 'Modifier'}</button>
                              <button onClick={() => setPendingDeleteId(zone.id)} disabled={savingId === zone.id} aria-label={`Supprimer la zone ${zone.code}`} className="min-h-8 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-red-600 flex items-center gap-1 disabled:opacity-50"><IconTrash size={14} stroke={1.5} /></button>
                            </div>
                          )}
                        </div>
                        {canManage && editingId === zone.id && (
                          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                            <ZoneForm initial={zone} allZones={zones} submitLabel="Enregistrer" isSaving={savingId === zone.id} onSubmit={(form) => handleUpdate(zone.id, form)} onCancel={() => setEditingId(null)} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!canManage ? null : creating ? (
        <div className="border border-dashed border-gray-200 rounded-lg p-4"><p className="text-xs font-medium text-gray-500 mb-3">Nouvelle zone</p><ZoneForm allZones={zones} submitLabel="Ajouter" isSaving={savingId === 'new'} onSubmit={handleCreate} onCancel={() => setCreating(false)} /></div>
      ) : (
        <button onClick={() => setCreating(true)} className="min-h-11 flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)]"><IconPlus size={14} stroke={1.5} />Ajouter une zone</button>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Supprimer cette zone ?"
        description={tariffMode
          ? 'En mode grille tarifaire, les codes postaux de cette zone ne seront plus couverts par le forfait dès le prochain devis client. Les observations passées conservent leur code de zone historique.'
          : 'Les observations passées liées à cette zone conservent leur code de zone historique. Si la grille tarifaire est activée plus tard, ces codes postaux ne seront pas couverts.'}
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
