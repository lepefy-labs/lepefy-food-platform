'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import Button from '../../../_components/ui/Button';
import type { RentalDeliveryZone } from '@lepefy/types';

interface Props {
  initialZones: RentalDeliveryZone[];
  currency: string;
  initialDeliveryEnabled: boolean;
  initialCountries: string[];
}

export default function RentalDeliveryZonesClient({ initialZones, currency, initialDeliveryEnabled, initialCountries }: Props) {
  const [deliveryEnabled, setDeliveryEnabled] = useState(initialDeliveryEnabled);
  const [countriesInput, setCountriesInput] = useState(initialCountries.join(', '));
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const [zones, setZones] = useState(initialZones);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [prefixes, setPrefixes] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [feeAmount, setFeeAmount] = useState('');
  const [note, setNote] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = saving || removingId !== null;
  const inputClass = 'mt-1.5 min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] sm:text-sm';

  async function saveSettings() {
    setSavingSettings(true);
    setSettingsSaved(false);
    try {
      const countries = countriesInput.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
      const res = await fetch('/api/admin/evenementiel/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rental_delivery_enabled: deliveryEnabled, rental_delivery_countries: countries }),
      });
      if (res.ok) setSettingsSaved(true);
    } finally {
      setSavingSettings(false);
    }
  }

  function resetForm() {
    setEditingId(null);
    setLabel(''); setPrefixes(''); setCity(''); setCountry(''); setFeeAmount(''); setNote(''); setActive(true);
    setError(null);
  }

  function editZone(zone: RentalDeliveryZone) {
    setEditingId(zone.id);
    setLabel(zone.label);
    setPrefixes((zone.postal_code_prefixes ?? []).join(', '));
    setCity(zone.city ?? ''); setCountry(zone.country ?? '');
    setFeeAmount(String(zone.fee_amount)); setNote(zone.note ?? ''); setActive(zone.active);
    setError(null);
  }

  async function saveZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const fee = Number(feeAmount);
    if (!label.trim() || !Number.isFinite(fee) || fee < 0) {
      setError('Label et montant valides requis.');
      return;
    }
    setSaving(true);
    try {
      const postalCodePrefixes = prefixes.split(',').map((p) => p.trim()).filter(Boolean);
      const res = await fetch(editingId
        ? '/api/admin/evenementiel/rental-delivery-zones/' + editingId
        : '/api/admin/evenementiel/rental-delivery-zones', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          postal_code_prefixes: postalCodePrefixes,
          city: city.trim() || null,
          country: country.trim() || null,
          fee_amount: fee,
          note: note.trim() || null,
          active,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? 'Erreur lors de l’enregistrement.');
      setZones((previous) => editingId
        ? previous.map((z) => z.id === editingId ? result : z)
        : [...previous, result]);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setSaving(false);
    }
  }

  async function removeZone(id: string) {
    if (busy) return;
    if (!confirm('Supprimer cette zone de livraison ?')) return;
    setError(null); setRemovingId(id);
    try {
      const res = await fetch('/api/admin/evenementiel/rental-delivery-zones/' + id, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? 'Erreur lors de la suppression.');
      setZones((previous) => previous.filter((z) => z.id !== id));
      if (editingId === id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-100 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Activation</h2>
        <label className="flex min-h-11 items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={deliveryEnabled} onChange={(e) => setDeliveryEnabled(e.target.checked)} className="size-4" />
          Proposer la livraison sur la page location matériel
        </label>
        <label className="mt-3 block text-sm text-gray-600">Pays autorisés (codes ISO2, séparés par des virgules)
          <input value={countriesInput} onChange={(e) => setCountriesInput(e.target.value)} placeholder="Ex. IT, FR" className={inputClass} />
        </label>
        <p className="mt-1 text-xs text-gray-500">Si l’adresse du client n’est pas dans un de ces pays, l’option livraison n’est pas proposée.</p>
        <div className="mt-3 flex items-center gap-3">
          <Button type="button" onClick={saveSettings} loading={savingSettings}>Enregistrer</Button>
          {settingsSaved && <span className="text-xs text-green-700">Enregistré.</span>}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Zones de livraison</h2>
          <span className="text-xs text-gray-500">{zones.length} zone{zones.length > 1 ? 's' : ''}</span>
        </div>
        <div className="mb-5 space-y-3">
          {zones.map((zone) => (
            <article key={zone.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 p-3">
              <div className="min-w-0 flex-1 basis-40">
                <p className={'break-words text-sm font-medium ' + (zone.active ? 'text-gray-900' : 'text-gray-400')}>{zone.label}</p>
                <p className="text-xs text-gray-500">
                  {zone.country ?? 'Tous pays'}{zone.postal_code_prefixes?.length ? ` · CP ${zone.postal_code_prefixes.join(', ')}` : ''}{zone.city ? ` · ${zone.city}` : ''}
                </p>
                <p className="mt-1 text-xs text-gray-500">{formatPrice(zone.fee_amount, currency)}{!zone.active && ' · Inactive'}</p>
              </div>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => editZone(zone)} aria-label={'Modifier ' + zone.label}>
                  <IconPencil size={16} /> Modifier
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => removeZone(zone.id)} aria-label={'Supprimer ' + zone.label}>
                  <IconTrash size={16} />
                </Button>
              </div>
            </article>
          ))}
          {zones.length === 0 && <p className="text-sm text-gray-400">Aucune zone — hors zone, le supplément reste à évaluer manuellement.</p>}
        </div>

        <form onSubmit={saveZone} className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-800">{editingId ? 'Modifier la zone' : 'Ajouter une zone'}</h3>
          <fieldset disabled={busy} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-gray-600 sm:col-span-2">Label *
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. Paris intra-muros" required className={inputClass} />
              </label>
              <label className="text-sm text-gray-600">Pays (ISO2)
                <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Ex. FR" className={inputClass} />
              </label>
              <label className="text-sm text-gray-600">Supplément ({currency}) *
                <input value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" required className={inputClass} />
              </label>
              <label className="text-sm text-gray-600">Préfixes code postal
                <input value={prefixes} onChange={(e) => setPrefixes(e.target.value)} placeholder="Ex. 75, 92" className={inputClass} />
              </label>
              <label className="text-sm text-gray-600">Ville
                <input value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
              </label>
              <label className="text-sm text-gray-600 sm:col-span-2">Note (visible admin uniquement)
                <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
              </label>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4" />
              Zone active
            </label>
            <p className="text-xs text-gray-500">Laissez préfixes/ville vides pour une zone valable sur tout le pays.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={saving} disabled={busy}>
                <IconPlus size={16} /> {saving ? 'Enregistrement…' : editingId ? 'Enregistrer la zone' : 'Ajouter la zone'}
              </Button>
              {editingId && <Button type="button" variant="ghost" onClick={resetForm}>Annuler</Button>}
            </div>
          </fieldset>
          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        </form>
      </section>
    </div>
  );
}
