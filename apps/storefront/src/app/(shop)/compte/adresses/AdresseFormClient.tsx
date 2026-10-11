'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconArrowLeft } from '@tabler/icons-react';
import { CustomerAddressForm, addressFieldId } from '@/components/address/CustomerAddressForm';
import ConfirmActionModal from '@/components/ui/ConfirmActionModal';
import { CheckboxField, ErrorSummary } from '@/components/ui/form';
import {
  ADDRESS_FIELD_LABELS,
  ADDRESS_FIELD_ORDER,
  composeLine1,
  defaultDeliveryCountry,
  emptyAddressDraft,
  normalizePostalCode,
  shippingAddressToDraft,
  validateAddressDraft,
  type AddressDraft,
  type AddressErrors,
} from '@/lib/address/addressRules';
import { ADDRESS_COPY } from '@/lib/storefrontCopy/addressCopy';
import type { Address } from '@lepefy/types';

const ID_PREFIX = 'compte-adresse';

/** Champ API (`line1`, `postal_code`…) → champ du formulaire. */
const SERVER_FIELD: Record<string, keyof AddressErrors> = {
  full_name: 'fullName', line1: 'street', line2: 'line2', city: 'city', postal_code: 'postalCode', country: 'country',
};

interface AdresseFormClientProps {
  address?:          Address;
  defaultFullName?:  string | null;
  defaultCountry:    string;
}

export function AdresseFormClient({ address, defaultFullName, defaultCountry }: AdresseFormClientProps) {
  const router = useRouter();
  const isEdit = Boolean(address);
  const [draft, setDraft] = useState<AddressDraft>(() => (address
    ? shippingAddressToDraft(address)
    : { ...emptyAddressDraft(defaultDeliveryCountry(defaultCountry)), fullName: defaultFullName ?? '' }));
  const [isDefault, setIsDefault]     = useState(address?.is_default ?? false);
  const [submitted, setSubmitted]     = useState(false);
  const [serverErrors, setServerErrors] = useState<AddressErrors>({});
  const [error, setError]             = useState<string | null>(null);
  const [isSaving, setIsSaving]       = useState(false);
  const [isDeleting, setIsDeleting]   = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  const errors = validateAddressDraft(draft, { requireFullName: true });
  const summaryItems = submitted
    ? ADDRESS_FIELD_ORDER.filter((field) => errors[field] || serverErrors[field])
      .map((field) => ({ fieldId: addressFieldId(ID_PREFIX, field), label: ADDRESS_FIELD_LABELS[field] }))
    : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.keys(errors).length > 0) {
      window.requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setIsSaving(true);
    try {
      const body = {
        fullName:   (draft.fullName ?? '').trim(),
        line1:      composeLine1(draft.street, draft.houseNumber),
        line2:      draft.line2.trim() || null,
        city:       draft.city.trim(),
        postalCode: normalizePostalCode(draft.country, draft.postalCode),
        country:    draft.country,
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const field = typeof data.field === 'string' ? SERVER_FIELD[data.field] : undefined;
        if (field) setServerErrors({ [field]: data.error });
        else setError(data.error ?? "L'adresse n'a pas pu être enregistrée. Réessayez.");
        return;
      }
      router.push(`/compte?adresse=${isEdit ? 'modifiee' : 'ajoutee'}`);
      router.refresh();
    } catch {
      setError("L'adresse n'a pas pu être enregistrée. Vérifiez votre connexion, puis réessayez.");
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "L'adresse n'a pas pu être supprimée. Réessayez.");
        return;
      }
      setDeleteModalOpen(false);
      router.push('/compte');
      router.refresh();
    } catch {
      setError("L'adresse n'a pas pu être supprimée. Vérifiez votre connexion, puis réessayez.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <div className="min-h-screen flex justify-center px-4 py-8 sm:py-10" style={{ backgroundColor: '#f7f8f6' }}>
        <div className="w-full flex flex-col gap-4" style={{ maxWidth: 480 }}>
          <Link href="/compte" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-gray-700">
            <IconArrowLeft size={16} stroke={1.8} aria-hidden="true" />
            Mon compte
          </Link>

          <div className="w-full flex flex-col overflow-hidden rounded-[20px] border border-gray-200 bg-white">
            <div className="px-5 pt-5 pb-4 border-b border-gray-100">
              <h1 className="font-display text-lg font-bold text-gray-950">
                {isEdit ? ADDRESS_COPY.editAddress : ADDRESS_COPY.newAddress}
              </h1>
              <p className="mt-1 text-sm text-gray-700">{ADDRESS_COPY.allRequired}</p>
            </div>

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5 px-5 pt-5 pb-6">
              <ErrorSummary ref={summaryRef} items={summaryItems} />

              <CustomerAddressForm
                idPrefix={ID_PREFIX}
                value={draft}
                onChange={(next, changed) => {
                  setDraft(next);
                  if (changed.some((field) => serverErrors[field])) setServerErrors({});
                }}
                showFullName
                showAllErrors={submitted}
                serverErrors={serverErrors}
                searchMode={isEdit ? 'collapsed' : 'open'}
              />

              <CheckboxField
                label={ADDRESS_COPY.makeDefault}
                checked={isDefault}
                disabled={address?.is_default}
                onChange={(e) => setIsDefault(e.target.checked)}
              />

              {error && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800" role="alert">{error}</p>
              )}

              <button
                type="submit"
                disabled={isSaving || isDeleting}
                className="min-h-[52px] w-full rounded-2xl text-base font-bold text-white disabled:opacity-60"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {isSaving ? ADDRESS_COPY.saving : ADDRESS_COPY.save}
              </button>

              {isEdit && (
                <button
                  type="button"
                  onClick={() => setDeleteModalOpen(true)}
                  disabled={isSaving || isDeleting}
                  className="min-h-12 w-full rounded-2xl border-[1.5px] border-red-300 text-sm font-semibold text-red-700 disabled:opacity-60"
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
