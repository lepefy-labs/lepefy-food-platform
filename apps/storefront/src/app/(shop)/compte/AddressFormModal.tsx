'use client';

import { useState } from 'react';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { Modal } from './Modal';
import type { Address } from '@lepefy/types';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-1 block';

// Même liste que CartClient.tsx (non partagée/exportée ailleurs dans le
// projet) — Packlink dessert ces marchés, cf. calculateShipping.ts.
const COUNTRIES = [
  { value: 'IT', label: 'Italie' },
  { value: 'FR', label: 'France' },
  { value: 'BE', label: 'Belgique' },
  { value: 'DE', label: 'Allemagne' },
  { value: 'CH', label: 'Suisse' },
];

// Identique à CheckoutForm.tsx (non exportée de là-bas) — reconstitue
// rue + numéro à partir de addresses.line1 pour pré-remplir le formulaire
// en édition.
function splitLine1(line1: string): { street: string; houseNumber: string } {
  const parts = line1.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { street: line1.trim(), houseNumber: '' };
  const last = parts[parts.length - 1] ?? '';
  if (/\d/.test(last) || /^s\.?\s?n\.?$/i.test(last)) {
    return { street: parts.slice(0, -1).join(' '), houseNumber: last };
  }
  return { street: parts.join(' '), houseNumber: '' };
}

interface AddressFormModalProps {
  address?:          Address;
  defaultFullName?:  string | null;
  defaultCountry:    string;
  onClose:           () => void;
  onSaved:           (address: Address) => void;
  onDeleted:         (id: string) => void;
}

export function AddressFormModal({
  address,
  defaultFullName,
  defaultCountry,
  onClose,
  onSaved,
  onDeleted,
}: AddressFormModalProps) {
  const isEdit = Boolean(address);
  const initialSplit = address ? splitLine1(address.line1) : { street: '', houseNumber: '' };
  const initialCountry = address?.country ?? (COUNTRIES.some((c) => c.value === defaultCountry) ? defaultCountry : 'IT');

  const [fullName, setFullName]       = useState(address?.full_name ?? defaultFullName ?? '');
  const [street, setStreet]           = useState(initialSplit.street);
  const [houseNumber, setHouseNumber] = useState(initialSplit.houseNumber);
  const [city, setCity]               = useState(address?.city ?? '');
  const [postalCode, setPostalCode]   = useState(address?.postal_code ?? '');
  const [country, setCountry]         = useState(initialCountry);
  const [manualMode, setManualMode]   = useState(isEdit);
  const [isDefault, setIsDefault]     = useState(address?.is_default ?? false);
  const [error, setError]             = useState<string | null>(null);
  const [isSaving, setIsSaving]       = useState(false);
  const [isDeleting, setIsDeleting]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !street.trim() || !houseNumber.trim() || !city.trim() || !postalCode.trim()) {
      setError('Merci de compléter tous les champs (indiquez « s.n. » si l\'adresse n\'a pas de numéro).');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const body = {
        fullName:   fullName.trim(),
        line1:      `${street.trim()} ${houseNumber.trim()}`.trim(),
        city:       city.trim(),
        postalCode: postalCode.trim(),
        country,
        isDefault,
      };
      const res = await fetch(
        isEdit ? `/api/customers/me/addresses/${address!.id}` : '/api/customers/me/addresses',
        {
          method:  isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(body),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de l\'enregistrement.');
        return;
      }
      onSaved(data as Address);
    } catch {
      setError('Erreur lors de l\'enregistrement.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!address) return;
    if (!window.confirm('Supprimer cette adresse ?')) return;
    setIsDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/me/addresses/${address.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de la suppression.');
        return;
      }
      onDeleted(address.id);
    } catch {
      setError('Erreur lors de la suppression.');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Modal
        title={isEdit ? 'Modifier l\'adresse' : 'Nouvelle adresse'}
        onClose={onClose}
        footer={
          <div className="space-y-3">
            <button
              type="submit"
              disabled={isSaving || isDeleting}
              className="w-full py-2.5 rounded-xl font-semibold text-white text-sm disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {isSaving ? 'Enregistrement…' : 'Enregistrer'}
            </button>

            {isEdit && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isSaving || isDeleting}
                className="w-full py-2.5 rounded-xl font-semibold text-sm text-red-600 border border-red-200 disabled:opacity-50"
              >
                {isDeleting ? 'Suppression…' : 'Supprimer cette adresse'}
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <label className={LABEL_CLS}>Nom du destinataire</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={INPUT_CLS} placeholder="Prénom et nom" />
          </div>

          <div>
            <label className={LABEL_CLS}>Pays</label>
            <select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                setManualMode(false);
                setStreet('');
                setHouseNumber('');
                setCity('');
                setPostalCode('');
              }}
              className={INPUT_CLS}
            >
              {COUNTRIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_CLS}>Adresse</label>
            {manualMode ? (
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Rue" className={INPUT_CLS} />
                </div>
                <input value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} placeholder="Numéro" className={INPUT_CLS} />
              </div>
            ) : (
              <AddressAutocomplete
                country={country}
                placeholder="Rue et numéro, ville"
                onSelect={(r) => {
                  setStreet(r.street);
                  setHouseNumber(r.houseNumber);
                  setCity(r.city);
                  setPostalCode(r.postalCode);
                }}
                onManualFallback={() => setManualMode(true)}
              />
            )}
          </div>

          {(manualMode || street) && (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="Code postal"
                inputMode="numeric"
                className={INPUT_CLS}
              />
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ville" className={INPUT_CLS} />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={isDefault}
              disabled={address?.is_default}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded border-gray-300"
              style={{ accentColor: 'var(--color-primary)' }}
            />
            Définir comme adresse par défaut
          </label>

          {error && <p className="text-red-500 text-xs">{error}</p>}
        </div>
      </Modal>
    </form>
  );
}
