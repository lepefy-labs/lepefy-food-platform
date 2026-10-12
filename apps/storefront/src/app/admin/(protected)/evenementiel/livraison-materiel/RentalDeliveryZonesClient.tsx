'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import type { RentalDeliveryZone } from '@lepefy/types';
import { useConfirm } from '@/app/admin/_components/ui/ConfirmDialog';
import Button from '../../../_components/ui/Button';
import Badge from '../../../_components/ui/Badge';
import Dialog from '../../../_components/ui/Dialog';
import InlineAlert, { ErrorText } from '../../../_components/ui/InlineAlert';
import { FormField, Input, Select } from '../../../_components/ui/Form';
import { useAdminToast } from '../../../_components/ui/Toaster';
import { formatMoney } from '@/lib/admin/format';
import { DELIVERY_COUNTRIES, countryLabel, isDeliveryCountry, normalizePostalCode } from '@/lib/address/addressRules';
import type { PostalLookupCity } from '@/lib/address/postalLookup';
import { isCountryAllowedForDelivery, matchDeliveryZone } from '@/lib/rental/matchDeliveryZone';
import {
  DELIVERY_ZONE_KINDS,
  deliveryZoneKind,
  findDeliveryZoneConflict,
  matchedPostalPrefix,
  normalizeDeliveryZone,
  type DeliveryZoneField,
  type DeliveryZoneKind,
} from '@/lib/rental/deliveryZoneRules';
import { cn } from '@/lib/utils/cn';

interface Props {
  initialZones: RentalDeliveryZone[];
  currency: string;
  initialDeliveryEnabled: boolean;
  initialCountries: string[];
}

interface ZoneDraft {
  label: string;
  country: string;
  kind: DeliveryZoneKind;
  prefixes: string;
  city: string;
  fee: string;
  note: string;
  active: boolean;
}

const KIND_LABEL: Record<DeliveryZoneKind, string> = Object.fromEntries(
  DELIVERY_ZONE_KINDS.map((entry) => [entry.value, entry.label]),
) as Record<DeliveryZoneKind, string>;

const ZONE_FORM_ID = 'rental-delivery-zone-form';
const STANDARD_COUNTRIES = DELIVERY_COUNTRIES.map((entry) => entry.code as string);

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export default function RentalDeliveryZonesClient({ initialZones, currency, initialDeliveryEnabled, initialCountries }: Props) {
  const toast = useAdminToast();
  const [ask, confirmDialog] = useConfirm();

  // Réglages enregistrés (servent au test et aux avertissements) et brouillon.
  const [saved, setSaved] = useState({ enabled: initialDeliveryEnabled, countries: initialCountries });
  const [deliveryEnabled, setDeliveryEnabled] = useState(initialDeliveryEnabled);
  const [countries, setCountries] = useState(initialCountries);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const settingsDirty = deliveryEnabled !== saved.enabled || !sameList(countries, saved.countries);
  // Les 5 pays standard, plus un code déjà enregistré hors liste.
  const countryChoices = useMemo(
    () => [...new Set([...STANDARD_COUNTRIES, ...initialCountries])],
    [initialCountries],
  );

  const [zones, setZones] = useState(initialZones);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ZoneDraft>(() => emptyDraft(initialCountries));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DeliveryZoneField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function toggleCountry(code: string) {
    setSettingsError(null);
    setCountries((previous) => previous.includes(code)
      ? previous.filter((entry) => entry !== code)
      : countryChoices.filter((entry) => entry === code || previous.includes(entry)));
  }

  async function saveSettings() {
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const res = await fetch('/api/admin/evenementiel/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rental_delivery_enabled: deliveryEnabled, rental_delivery_countries: countries }),
      });
      const result = await res.json().catch(() => ({})) as { error?: string; rental_delivery_enabled?: boolean; rental_delivery_countries?: string[] };
      if (!res.ok) {
        setSettingsError(result.error ?? 'Enregistrement impossible. Réessayez.');
        return;
      }
      const next = {
        enabled: result.rental_delivery_enabled ?? deliveryEnabled,
        countries: result.rental_delivery_countries ?? countries,
      };
      setSaved(next);
      setDeliveryEnabled(next.enabled);
      setCountries(next.countries);
      toast.success('Livraison enregistrée.');
    } catch {
      setSettingsError('Connexion impossible. Vérifiez le réseau puis réessayez.');
    } finally {
      setSavingSettings(false);
    }
  }

  function updateDraft(patch: Partial<ZoneDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    const touched = Object.keys(patch).map((key) => (key === 'prefixes' ? 'postal_code_prefixes' : key === 'fee' ? 'fee_amount' : key));
    setFieldErrors((previous) => {
      const next = { ...previous };
      for (const key of touched) delete next[key as DeliveryZoneField];
      if (patch.kind) { delete next.postal_code_prefixes; delete next.city; }
      return next;
    });
    setFormError(null);
  }

  function openCreate() {
    setEditingId(null);
    setDraft(emptyDraft(saved.countries));
    setFieldErrors({});
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(zone: RentalDeliveryZone) {
    setEditingId(zone.id);
    setDraft({
      label: zone.label,
      country: zone.country ?? '',
      kind: deliveryZoneKind(zone),
      prefixes: (zone.postal_code_prefixes ?? []).join(', '),
      city: zone.city ?? '',
      fee: String(zone.fee_amount),
      note: zone.note ?? '',
      active: zone.active,
    });
    setFieldErrors({});
    setFormError(null);
    setDialogOpen(true);
  }

  async function saveZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const normalized = normalizeDeliveryZone({
      label: draft.label,
      country: draft.country,
      kind: draft.kind,
      postal_code_prefixes: draft.prefixes,
      city: draft.city,
      fee_amount: draft.fee,
      note: draft.note,
      active: draft.active,
    });
    if (!normalized.ok) {
      setFieldErrors({ [normalized.field]: normalized.error });
      return;
    }
    const conflict = findDeliveryZoneConflict(normalized.zone, zones, editingId);
    if (conflict) {
      setFieldErrors({ [conflict.field]: conflict.error });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(editingId
        ? '/api/admin/evenementiel/rental-delivery-zones/' + editingId
        : '/api/admin/evenementiel/rental-delivery-zones', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...normalized.zone, kind: normalized.kind }),
      });
      const result = await res.json().catch(() => ({})) as RentalDeliveryZone & { error?: string; field?: DeliveryZoneField };
      if (!res.ok) {
        if (result.field) setFieldErrors({ [result.field]: result.error ?? 'Valeur invalide.' });
        else setFormError(result.error ?? 'Enregistrement impossible. Réessayez.');
        return;
      }
      setZones((previous) => editingId
        ? previous.map((zone) => (zone.id === editingId ? result : zone))
        : [...previous, result]);
      setDialogOpen(false);
      toast.success(editingId ? 'Zone enregistrée.' : 'Zone ajoutée.');
    } catch {
      setFormError('Connexion impossible. Vérifiez le réseau puis réessayez.');
    } finally {
      setSaving(false);
    }
  }

  async function removeZone(zone: RentalDeliveryZone) {
    if (removingId) return;
    const confirmed = await ask({
      title: `Supprimer la zone « ${zone.label} » ?`,
      description: 'Les réservations déjà faites gardent leur supplément.',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!confirmed) return;
    setRemovingId(zone.id);
    try {
      const res = await fetch('/api/admin/evenementiel/rental-delivery-zones/' + zone.id, { method: 'DELETE' });
      const result = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        toast.error(result.error ?? 'Suppression impossible. Réessayez.');
        return;
      }
      setZones((previous) => previous.filter((entry) => entry.id !== zone.id));
      toast.success('Zone supprimée.');
    } catch {
      toast.error('Connexion impossible. Vérifiez le réseau puis réessayez.');
    } finally {
      setRemovingId(null);
    }
  }

  // Pays proposés dans une zone : ceux de livraison (ou les 5 standard s'il
  // n'y en a aucun), plus le pays actuel de la zone modifiée.
  const zoneCountryCodes = useMemo(() => {
    const base = saved.countries.length > 0 ? saved.countries : STANDARD_COUNTRIES;
    return draft.country && !base.includes(draft.country) ? [...base, draft.country] : base;
  }, [saved.countries, draft.country]);

  return (
    <div className="space-y-6">
      {confirmDialog}

      <section aria-labelledby="rental-delivery-settings" className="space-y-4 rounded-2xl border border-a-border bg-a-surface p-4">
        <h2 id="rental-delivery-settings" className="text-sm font-semibold text-a-text-2">Livraison sur le site</h2>
        <label className="flex min-h-10 items-center gap-2 text-sm text-a-text">
          <input type="checkbox" checked={deliveryEnabled} onChange={(event) => { setDeliveryEnabled(event.target.checked); setSettingsError(null); }} className="size-4 accent-a-brand" />
          Proposer la livraison sur la page location matériel
        </label>
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-a-text">Pays de livraison</legend>
          <div className="flex flex-wrap gap-2">
            {countryChoices.map((code) => {
              const selected = countries.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleCountry(code)}
                  className={cn(
                    'inline-flex min-h-9 items-center rounded-full border px-3 text-sm transition-colors',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-a-focus',
                    selected
                      ? 'border-a-brand bg-a-brand-soft font-semibold text-a-brand-fg'
                      : 'border-a-border-strong bg-a-surface text-a-text-2 hover:bg-a-hover',
                  )}
                >
                  {selected && <span aria-hidden="true" className="mr-1">✓</span>}
                  {countryLabel(code)}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs leading-5 text-a-text-3">Le client choisit son pays dans cette liste. Hors de ces pays, seul le retrait est proposé.</p>
        </fieldset>
        {deliveryEnabled && countries.length === 0 && (
          <InlineAlert tone="warning" title="Aucun pays choisi.">La livraison ne sera pas proposée aux clients.</InlineAlert>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={saveSettings} loading={savingSettings} disabled={!settingsDirty}>Enregistrer</Button>
          {settingsDirty && !savingSettings && <span className="text-xs text-a-text-3">Modifications non enregistrées.</span>}
        </div>
        <ErrorText message={settingsError} />
      </section>

      <section aria-labelledby="rental-delivery-zones" className="space-y-3 rounded-2xl border border-a-border bg-a-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="rental-delivery-zones" className="text-sm font-semibold text-a-text-2">Zones et suppléments</h2>
          <Button type="button" variant="secondary" size="sm" onClick={openCreate}>
            <IconPlus size={16} aria-hidden="true" /> Ajouter une zone
          </Button>
        </div>
        <p className="text-xs leading-5 text-a-text-3">
          Pour une adresse, la zone la plus précise gagne : <strong className="font-semibold text-a-text-2">code postal</strong> (le début le plus long),
          puis <strong className="font-semibold text-a-text-2">ville</strong>, puis <strong className="font-semibold text-a-text-2">tout le pays</strong>.
          Seules les zones actives comptent. Sans zone, le supplément est à évaluer à la main.
        </p>
        {zones.length === 0 ? (
          <p className="rounded-xl border border-dashed border-a-border-strong px-4 py-6 text-center text-sm text-a-text-3">
            Aucune zone. Toutes les livraisons ont un supplément à évaluer à la main.
          </p>
        ) : (
          <ul className="space-y-2">
            {zones.map((zone) => {
              const kind = deliveryZoneKind(zone);
              const notOffered = Boolean(zone.country) && !saved.countries.includes(zone.country ?? '');
              return (
                <li key={zone.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-a-border p-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className={cn('break-words text-sm font-semibold', zone.active ? 'text-a-text' : 'text-a-text-3')}>{zone.label}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-a-text-3">
                      <Badge>{KIND_LABEL[kind]}</Badge>
                      <span>{zone.country ? countryLabel(zone.country) : 'Tous pays'}</span>
                      {kind === 'postal' && <span>· {(zone.postal_code_prefixes ?? []).join(', ')}</span>}
                      {kind === 'city' && <span className="break-words">· {zone.city}</span>}
                      {!zone.active && <Badge>Inactive</Badge>}
                      {notOffered && <Badge tone="warning">Pays non proposé aux clients</Badge>}
                    </div>
                    {zone.note && <p className="mt-1 break-words text-xs text-a-text-3">{zone.note}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="mr-1 whitespace-nowrap text-sm font-semibold tabular-nums text-a-text">{formatMoney(zone.fee_amount, currency)}</span>
                    <Button type="button" variant="ghost" size="sm" disabled={removingId !== null} onClick={() => openEdit(zone)} aria-label={`Modifier ${zone.label}`}>
                      <IconPencil size={16} aria-hidden="true" /> <span className="hidden sm:inline">Modifier</span>
                    </Button>
                    <Button type="button" variant="ghost" size="sm" loading={removingId === zone.id} disabled={removingId !== null} onClick={() => removeZone(zone)} aria-label={`Supprimer ${zone.label}`}>
                      {removingId !== zone.id && <IconTrash size={16} aria-hidden="true" />}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AddressTester zones={zones} saved={saved} currency={currency} />

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        dismissible={!saving}
        title={editingId ? 'Modifier la zone' : 'Ajouter une zone'}
        size="md"
        footer={(
          <>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>Annuler</Button>
            <Button type="submit" form={ZONE_FORM_ID} loading={saving}>{editingId ? 'Enregistrer la zone' : 'Ajouter la zone'}</Button>
          </>
        )}
      >
        <form id={ZONE_FORM_ID} onSubmit={saveZone} noValidate className="space-y-4">
          <FormField label="Nom de la zone" required hint="Visible seulement dans l’admin." error={fieldErrors.label}>
            <Input value={draft.label} onChange={(event) => updateDraft({ label: event.target.value })} placeholder="Ex. Reggio Emilia centre" maxLength={80} />
          </FormField>
          <FormField label="Pays" required hint="Seulement les pays de livraison choisis plus haut." error={fieldErrors.country}>
            <Select value={draft.country} onChange={(event) => updateDraft({ country: event.target.value, city: '' })}>
              <option value="" disabled>Choisir un pays</option>
              {zoneCountryCodes.map((code) => (
                <option key={code} value={code}>
                  {countryLabel(code)}{saved.countries.length > 0 && !saved.countries.includes(code) ? ' (non proposé aux clients)' : ''}
                </option>
              ))}
            </Select>
          </FormField>
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-a-text">La zone couvre</legend>
            <div className="grid grid-cols-3 gap-2">
              {DELIVERY_ZONE_KINDS.map((entry) => (
                <label
                  key={entry.value}
                  className={cn(
                    'flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-a-border-strong px-2 text-center text-sm text-a-text-2',
                    'has-[:checked]:border-a-brand has-[:checked]:bg-a-brand-soft has-[:checked]:font-semibold has-[:checked]:text-a-brand-fg',
                    'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-a-focus',
                  )}
                >
                  <input type="radio" name="zone-kind" value={entry.value} checked={draft.kind === entry.value} onChange={() => updateDraft({ kind: entry.value })} className="sr-only" />
                  {entry.label}
                </label>
              ))}
            </div>
            <ErrorText message={fieldErrors.kind} className="mt-1.5 text-xs" />
          </fieldset>
          {draft.kind === 'postal' && (
            <FormField
              label="Début des codes postaux"
              required
              hint="Ex. 421 = tous les codes de 42100 à 42199. Séparez par des virgules ou des espaces."
              error={fieldErrors.postal_code_prefixes}
            >
              <Input value={draft.prefixes} onChange={(event) => updateDraft({ prefixes: event.target.value })} placeholder="Ex. 421, 422" inputMode="text" autoComplete="off" />
            </FormField>
          )}
          {draft.kind === 'city' && (
            <CityField
              country={draft.country}
              value={draft.city}
              error={fieldErrors.city}
              onChange={(city) => updateDraft({ city })}
            />
          )}
          {draft.kind === 'country' && (
            <p className="text-xs leading-5 text-a-text-3">
              Vaut pour toutes les adresses de {draft.country ? countryLabel(draft.country) : 'ce pays'} qui ne sont dans aucune zone plus précise.
            </p>
          )}
          <FormField label={`Supplément (${currency})`} required error={fieldErrors.fee_amount}>
            <Input value={draft.fee} onChange={(event) => updateDraft({ fee: event.target.value })} inputMode="decimal" placeholder="Ex. 15" autoComplete="off" />
          </FormField>
          <FormField label="Note" optional hint="Visible seulement dans l’admin." error={fieldErrors.note}>
            <Input value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} placeholder="Ex. livraison le matin" maxLength={300} />
          </FormField>
          <label className="flex min-h-10 items-center gap-2 text-sm text-a-text">
            <input type="checkbox" checked={draft.active} onChange={(event) => updateDraft({ active: event.target.checked })} className="size-4 accent-a-brand" />
            Zone active
          </label>
          {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
        </form>
      </Dialog>
    </div>
  );
}

function emptyDraft(countries: string[]): ZoneDraft {
  return { label: '', country: countries[0] ?? '', kind: 'postal', prefixes: '', city: '', fee: '', note: '', active: true };
}

/** Ville d'une zone, avec suggestions de l'index des codes postaux (pays connus). */
function CityField({ country, value, error, onChange }: { country: string; value: string; error?: string; onChange: (value: string) => void }) {
  const [suggestions, setSuggestions] = useState<PostalLookupCity[]>([]);
  const [focused, setFocused] = useState(false);
  const query = value.trim();

  useEffect(() => {
    if (!focused || !isDeliveryCountry(country) || query.length < 3) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/address/postal-lookup?country=${country}&city=${encodeURIComponent(query)}`, { signal: controller.signal });
        const result = await res.json().catch(() => ({ cities: [] })) as { cities?: PostalLookupCity[] };
        setSuggestions((result.cities ?? []).filter((entry) => entry.city.toLowerCase() !== query.toLowerCase()).slice(0, 6));
      } catch {
        // Suggestions facultatives : le champ reste utilisable.
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [country, query, focused]);

  return (
    <div>
      <FormField
        label="Ville"
        required
        hint="Majuscules, accents et petits mots (di, nell’, de…) ne comptent pas : « Reggio nell’Emilia » = « Reggio Emilia »."
        error={error}
      >
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Ex. Modena"
          autoComplete="off"
          maxLength={80}
        />
      </FormField>
      {suggestions.length > 0 && (
        <ul aria-label="Villes proposées" className="mt-1 overflow-hidden rounded-lg border border-a-border bg-a-surface shadow-sm">
          {suggestions.map((entry) => (
            <li key={`${entry.city}-${entry.area ?? ''}`}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { onChange(entry.city); setSuggestions([]); }}
                className="flex min-h-10 w-full items-center gap-2 border-b border-a-border px-3 text-left text-sm text-a-text last:border-b-0 hover:bg-a-hover focus-visible:bg-a-hover focus-visible:outline-none"
              >
                <span className="font-medium">{entry.city}</span>
                {entry.area && <span className="text-xs text-a-text-3">{entry.area}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Zone et supplément appliqués à une adresse, avec le même calcul que le site. Rien n'est enregistré. */
function AddressTester({ zones, saved, currency }: {
  zones: RentalDeliveryZone[];
  saved: { enabled: boolean; countries: string[] };
  currency: string;
}) {
  const choices = saved.countries.length > 0 ? saved.countries : STANDARD_COUNTRIES;
  const [country, setCountry] = useState(choices[0] ?? 'IT');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const selectedCountry = choices.includes(country) ? country : choices[0] ?? 'IT';

  const result = useMemo(() => {
    if (!postalCode.trim() && !city.trim()) return null;
    const allowed = isCountryAllowedForDelivery(
      { rental_delivery_enabled: saved.enabled, rental_delivery_countries: saved.countries },
      selectedCountry,
    );
    if (!allowed) {
      return {
        tone: 'warning' as const,
        title: saved.enabled ? 'Pays non proposé' : 'Livraison désactivée',
        text: 'Le client ne peut choisir que le retrait.',
      };
    }
    const postal = normalizePostalCode(selectedCountry, postalCode);
    const zone = matchDeliveryZone(zones.filter((entry) => entry.active), { country: selectedCountry, postal_code: postal, city });
    if (!zone) {
      return { tone: 'info' as const, title: 'Aucune zone', text: 'Le supplément sera à évaluer à la main.' };
    }
    const kind = deliveryZoneKind(zone);
    const reason = kind === 'postal'
      ? `Trouvée par le code postal (début ${matchedPostalPrefix(zone, postal) ?? ''}).`
      : kind === 'city' ? 'Trouvée par la ville.' : 'Zone « tout le pays ».';
    return {
      tone: 'success' as const,
      title: `${zone.label} — ${formatMoney(zone.fee_amount, currency)}`,
      text: `${reason} Ajouté automatiquement à la réservation.`,
    };
  }, [zones, saved, selectedCountry, postalCode, city, currency]);

  return (
    <section aria-labelledby="rental-delivery-test" className="space-y-3 rounded-2xl border border-a-border bg-a-surface p-4">
      <h2 id="rental-delivery-test" className="text-sm font-semibold text-a-text-2">Tester une adresse</h2>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.4fr)]">
        <FormField label="Pays">
          <Select value={selectedCountry} onChange={(event) => setCountry(event.target.value)}>
            {choices.map((code) => <option key={code} value={code}>{countryLabel(code)}</option>)}
          </Select>
        </FormField>
        <FormField label="Code postal">
          <Input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} inputMode="numeric" autoComplete="off" placeholder="Ex. 42121" />
        </FormField>
        <FormField label="Ville">
          <Input value={city} onChange={(event) => setCity(event.target.value)} autoComplete="off" placeholder="Ex. Reggio Emilia" />
        </FormField>
      </div>
      {result
        ? <InlineAlert tone={result.tone} title={result.title}>{result.text}</InlineAlert>
        : <p className="text-xs leading-5 text-a-text-3">Saisissez un code postal ou une ville pour voir la zone et le supplément appliqués. Rien n’est enregistré.</p>}
    </section>
  );
}
