'use client';

import { useMemo, useState } from 'react';
import Button from '../../_components/ui/Button';
import InlineAlert from '../../_components/ui/InlineAlert';
import { Panel } from '../../_components/ui/Panel';
import { Input, Select, hintClasses, labelClasses } from '../../_components/ui/Form';
import { useAdminMutation } from '../../_components/ui/useAdminMutation';
import { countryDisplayName, filterCountries, phoneCountries } from '@/lib/address/countries';
import {
  STORAGE_LABELS, STORAGE_TYPES,
  type DestinationMode, type GeoPolicy, type StorageRestrictionMode, type StorageType,
} from '@/lib/shipping/geo/geoPolicy';

const DESTINATION_OPTIONS: Array<{ value: DestinationMode; label: string; hint: string }> = [
  { value: 'current', label: 'Pays actuellement configurés', hint: 'Les pays livrés aujourd’hui et ceux qui ont un forfait actif. Aucun changement.' },
  { value: 'eu', label: 'Union européenne', hint: 'Les 27 pays de l’UE, sous réserve d’un service transporteur.' },
  { value: 'carrier_all', label: 'Tous les pays compatibles avec le transporteur', hint: 'Le transporteur confirme chaque destination au moment du devis.' },
  { value: 'custom', label: 'Liste personnalisée', hint: 'Seuls les pays que vous sélectionnez.' },
];

const STORAGE_OPTIONS: Array<{ value: StorageRestrictionMode; label: string }> = [
  { value: 'none', label: 'Aucune restriction' },
  { value: 'store_country', label: 'Pays du magasin uniquement' },
  { value: 'eu', label: 'Union européenne' },
  { value: 'custom', label: 'Pays personnalisés' },
];

function CountryPicker({ value, onChange, disabled, label }: {
  value: string[]; onChange: (next: string[]) => void; disabled: boolean; label: string;
}) {
  const [query, setQuery] = useState('');
  const catalog = useMemo(() => phoneCountries('fr'), []);
  const shown = useMemo(() => filterCountries(catalog, query).slice(0, 60), [catalog, query]);
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code].sort());
  return (
    <div className="space-y-2">
      <label className={labelClasses} htmlFor={`picker-${label}`}>{label}</label>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${label} : sélection`}>
          {value.map((code) => (
            <li key={code}>
              <button
                type="button" disabled={disabled} onClick={() => toggle(code)}
                className="rounded-full bg-a-brand-soft px-2.5 py-1 text-xs font-medium text-a-brand-fg disabled:opacity-60"
                aria-label={`Retirer ${countryDisplayName(code)}`}
              >
                {countryDisplayName(code)} ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input id={`picker-${label}`} value={query} disabled={disabled} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un pays" />
      <ul className="max-h-48 overflow-auto rounded-lg border border-a-border">
        {shown.map((c) => (
          <li key={c.code}>
            <label className="flex min-h-10 cursor-pointer items-center gap-2 px-3 text-sm text-a-text hover:bg-a-hover">
              <input type="checkbox" disabled={disabled} checked={value.includes(c.code)} onChange={() => toggle(c.code)} />
              {c.name}
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-2 text-sm text-a-text-3">Aucun pays trouvé.</li>}
      </ul>
    </div>
  );
}

export function GeoPolicySection({ initial, configuredCountries, canManage, migrationReady }: {
  initial: GeoPolicy; configuredCountries: string[]; canManage: boolean; migrationReady: boolean;
}) {
  const [policy, setPolicy] = useState<GeoPolicy>(initial);
  const mutation = useAdminMutation();
  const disabled = !canManage || !migrationReady || mutation.pending;

  function setStorage(type: StorageType, patch: Partial<GeoPolicy['storageRules'][StorageType]>) {
    setPolicy((p) => ({ ...p, storageRules: { ...p.storageRules, [type]: { ...p.storageRules[type], ...patch } } }));
  }

  async function save() {
    const result = await mutation.run<{ version: number }>('/api/admin/shipping-geo-policy', {
      method: 'PUT',
      body: {
        destinationMode: policy.destinationMode,
        includedCountries: policy.includedCountries,
        excludedCountries: policy.excludedCountries,
        providerFallbackEnabled: policy.providerFallbackEnabled,
        storageRules: policy.storageRules,
        expectedVersion: policy.version,
      },
      successMessage: 'Configuration enregistrée.',
      errorToast: true,
    });
    if (result) setPolicy((p) => ({ ...p, version: result.version }));
  }

  const activeMode = DESTINATION_OPTIONS.find((o) => o.value === policy.destinationMode);

  return (
    <div className="mt-4 space-y-4">
      {!migrationReady && (
        <InlineAlert tone="warning" title="Configuration indisponible">
          La migration 179 n’est pas encore appliquée : ces réglages ne peuvent pas être enregistrés.
        </InlineAlert>
      )}

      <Panel
        title="Destinations et tarification"
        description="Les pays où vos clients peuvent commander. Un pays sélectionnable n’est pas forcément livrable : le transporteur confirme chaque destination au moment du devis."
      >
        <div className="space-y-4">
          <div>
            <label className={labelClasses} htmlFor="geo-destination-mode">Couverture géographique</label>
            <Select
              id="geo-destination-mode" disabled={disabled} value={policy.destinationMode}
              onChange={(e) => setPolicy((p) => ({ ...p, destinationMode: e.target.value as DestinationMode }))}
            >
              {DESTINATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            {activeMode && <p className={hintClasses}>{activeMode.hint}</p>}
          </div>

          {policy.destinationMode === 'custom' && (
            <CountryPicker
              label="Pays inclus" disabled={disabled} value={policy.includedCountries}
              onChange={(includedCountries) => setPolicy((p) => ({ ...p, includedCountries }))}
            />
          )}

          <CountryPicker
            label="Pays exclus" disabled={disabled} value={policy.excludedCountries}
            onChange={(excludedCountries) => setPolicy((p) => ({ ...p, excludedCountries }))}
          />

          <label className="flex items-start gap-3 text-sm text-a-text">
            <input
              type="checkbox" className="mt-1" disabled={disabled} checked={policy.providerFallbackEnabled}
              onChange={(e) => setPolicy((p) => ({ ...p, providerFallbackEnabled: e.target.checked }))}
            />
            <span>
              <span className="font-semibold">Devis automatique du transporteur pour les pays sans forfait</span>
              <span className={`${hintClasses} block`}>
                Quand un pays autorisé n’a pas de forfait actif, le prix affiché au client est le devis transporteur, supplément d’emballage inclus. Sans service disponible, la commande n’est pas possible et le retrait en boutique est proposé.
              </span>
            </span>
          </label>

          <div>
            <p className={labelClasses}>Forfaits actifs</p>
            {configuredCountries.length === 0
              ? <p className={hintClasses}>Aucun forfait actif.</p>
              : <p className="text-sm text-a-text-2">{configuredCountries.map((c) => countryDisplayName(c)).join(', ')}</p>}
          </div>
        </div>
      </Panel>

      <Panel
        title="Restrictions par conservation"
        description="Limitez les pays de livraison selon le mode de conservation des produits. « Aucune restriction » n’ajoute aucune limite de la part de Lepefy ; cela ne garantit pas le transport par le transporteur et ne remplace pas les obligations légales ou douanières."
      >
        <div className="space-y-5">
          {STORAGE_TYPES.map((type) => (
            <div key={type} className="space-y-2">
              <label className={labelClasses} htmlFor={`storage-${type}`}>{STORAGE_LABELS[type]}</label>
              <Select
                id={`storage-${type}`} disabled={disabled} value={policy.storageRules[type].mode}
                onChange={(e) => setStorage(type, { mode: e.target.value as StorageRestrictionMode })}
              >
                {STORAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
              {policy.storageRules[type].mode === 'custom' && (
                <CountryPicker
                  label={`Pays autorisés : ${STORAGE_LABELS[type]}`} disabled={disabled} value={policy.storageRules[type].countries}
                  onChange={(countries) => setStorage(type, { countries })}
                />
              )}
            </div>
          ))}
        </div>
      </Panel>

      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={save} loading={mutation.pending} disabled={!migrationReady}>Enregistrer</Button>
        </div>
      ) : (
        <p className={hintClasses}>Lecture seule.</p>
      )}
      {mutation.error && <InlineAlert tone="danger">{mutation.error}</InlineAlert>}
    </div>
  );
}
