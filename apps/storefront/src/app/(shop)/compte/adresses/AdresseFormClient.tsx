'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconArrowLeft } from '@tabler/icons-react';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import ConfirmActionModal from '@/components/ui/ConfirmActionModal';
import type { Address } from '@lepefy/types';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-1 block';

const COUNTRIES = [
  { value: 'IT', label: 'Italie' },
  { value: 'FR', label: 'France' },
  { value: 'BE', label: 'Belgique' },
  { value: 'DE', label: 'Allemagne' },
  { value: 'CH', label: 'Suisse' },
];

function splitLine1(line1: string): { street: string; houseNumber: string } {
  const parts = line1.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { street: line1.trim(), houseNumber: '' };
  const last = parts[parts.length - 1] ?? '';
  if (/\d/.test(last) || /^s\.?\s?n\.?$/i.test(last)) {
    return { street: parts.slice(0, -1).join(' '), houseNumber: last };
  }
  return { street: parts.join(' '), houseNumber: '' };
}

interface AdresseFormClientProps {
  address?:          Address;
  defaultFullName?:  string | null;
  defaultCountry:    string;
}

export function AdresseFormClient({ address, defaultFullName, defaultCountry }: AdresseFormClientProps) {
  const router = useRouter();
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
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

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
      router.push('/compte');
    } catch {
      setError('Erreur lors de l\'enregistrement.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!address) return;
    setIsDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/me/addresses/${address.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de la suppression.');
        return;
      }
      setDeleteModalOpen(false);
      router.push('/compte');
    } catch {
      setError('Erreur lors de la suppression.');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <div className="min-h-screen flex justify-center px-4 py-8 sm:py-10" style={{ backgroundColor: '#f7f8f6' }}>
        <div className="w-full flex flex-col gap-4" style={{ maxWidth: 430 }}>
          <Link href="/compte" className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500">
            <IconArrowLeft size={16} stroke={1.8} />
            Mon compte
          </Link>

          <div
            className="w-full flex flex-col overflow-hidden rounded-[20px]"
            style={{ boxShadow: '0 8px 30px rgba(20, 40, 30, 0.12)', backgroundColor: 'white' }}
          >
            <div className="px-5 pt-5 pb-4 border-b border-gray-100">
              <h1 className="font-bold text-gray-900" style={{ fontSize: 16 }}>
                {isEdit ? 'Modifier l\'adresse' : 'Nouvelle adresse'}
              </h1>
            </div>

            <form onSubmit={handleSubmit} className="px-5 pt-4 pb-6 space-y-3">
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
                  onClick={() => setDeleteModalOpen(true)}
                  disabled={isSaving || isDeleting}
                  className="w-full py-2.5 rounded-xl font-semibold text-sm text-red-600 border border-red-200 disabled:opacity-50"
                >
                  {isDeleting ? 'Suppression…' : 'Supprimer cette adresse'}
                </button>
              )}
            </form>
          </div>
        </div>
      </div>

      <ConfirmActionModal
        open={deleteModalOpen}
        title="Supprimer cette adresse ?"
        description="Cette adresse sera supprimée de votre compte. Cette action est définitive."
        confirmLabel="Supprimer"
        cancelLabel="Conserver"
        destructive
        loading={isDeleting}
        onCancel={() => {
          if (!isDeleting) setDeleteModalOpen(false);
        }}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
