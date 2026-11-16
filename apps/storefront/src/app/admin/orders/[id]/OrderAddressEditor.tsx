'use client';

import { useState } from 'react';
import { IconPencil } from '@tabler/icons-react';
import {
  ADDRESS_FIELD_LABELS,
  countryLabel,
  composeLine1,
  shippingAddressToDraft,
  validateAddressDraft,
  type AddressDraft,
  type AddressErrors,
  type AddressField,
} from '@/lib/address/addressRules';
import type { ShippingAddress } from '@lepefy/types';
import Button from '../../_components/ui/Button';
import Dialog from '../../_components/ui/Dialog';
import { FormField, Input } from '../../_components/ui/Form';
import InlineAlert from '../../_components/ui/InlineAlert';
import { useAdminMutation } from '../../_components/ui/useAdminMutation';
import { useAdminToast } from '../../_components/ui/Toaster';

interface Props {
  orderId: string;
  updatedAt: string;
  address: ShippingAddress;
  providerName: string | null;
}

interface SaveResult {
  changed: boolean;
  draftKeepsOldAddress: boolean;
  postalCodeChanged: boolean;
}

type EditableField = Exclude<AddressField, 'country'>;

function initialDraft(address: ShippingAddress): AddressDraft {
  return { ...shippingAddressToDraft(address), line2: address.line2 ?? '', fullName: address.full_name ?? '' };
}

/**
 * « Modifier l'adresse » of the order detail (orders.manage). Same address
 * rules as the checkout plus a mandatory house number; the country stays
 * fixed (the paid shipping price depends on it). After saving, warns when the
 * carrier draft still holds the old address or the postal code changed.
 */
export default function OrderAddressEditor({ orderId, updatedAt, address, providerName }: Props) {
  const toast = useAdminToast();
  const { run, pending, error, setError } = useAdminMutation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AddressDraft>(() => initialDraft(address));
  const [phone, setPhone] = useState(address.phone ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  const clientErrors: AddressErrors = validateAddressDraft(
    { ...draft, deliverToCompany: Boolean(draft.companyName?.trim()) },
    { requireFullName: true, allowedCountries: [address.country.toUpperCase()] },
  );
  const errorFor = (field: EditableField) => (submitted ? clientErrors[field] : undefined);

  function openDialog() {
    setDraft(initialDraft(address));
    setPhone(address.phone ?? '');
    setSubmitted(false);
    setResult(null);
    setError(null);
    setOpen(true);
  }

  function update(patch: Partial<AddressDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setError(null);
  }

  async function save() {
    setSubmitted(true);
    if (Object.keys(clientErrors).length > 0) return;
    const response = await run<SaveResult>(`/api/admin/orders/${orderId}/address`, {
      body: {
        expectedUpdatedAt: updatedAt,
        address: {
          full_name: draft.fullName,
          company_name: draft.companyName ?? '',
          line1: composeLine1(draft.street, draft.houseNumber),
          line2: draft.line2,
          postal_code: draft.postalCode,
          city: draft.city,
          country: address.country,
          phone,
        },
      },
    });
    if (!response) return;
    if (!response.changed) {
      setOpen(false);
      toast.info('Aucune modification.');
      return;
    }
    toast.success('Adresse modifiée.');
    if (response.draftKeepsOldAddress || response.postalCodeChanged) setResult(response);
    else setOpen(false);
  }

  const done = result !== null;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={openDialog} className="mt-2 -ml-2">
        <IconPencil size={15} aria-hidden="true" /> Modifier l’adresse
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!pending}
        title={done ? 'Adresse modifiée' : 'Modifier l’adresse de livraison'}
        description={done ? undefined : `Pays : ${countryLabel(address.country)} (il ne peut pas changer). Le prix de livraison payé ne change pas et le client n’est pas prévenu.`}
        size="md"
        footer={done ? (
          <Button onClick={() => setOpen(false)}>Fermer</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
            <Button onClick={() => void save()} loading={pending}>Enregistrer l’adresse</Button>
          </>
        )}
      >
        {done ? (
          <div className="space-y-3">
            {result.draftKeepsOldAddress && (
              <InlineAlert tone="warning" title={`Le brouillon ${providerName ?? 'du transporteur'} garde l’ancienne adresse`}>
                Avant d’acheter l’étiquette, supprimez le brouillon puis recréez-le dans la carte Expédition, ou corrigez l’adresse directement dans {providerName ?? 'l’outil du transporteur'}.
              </InlineAlert>
            )}
            {result.postalCodeChanged && (
              <InlineAlert tone="info" title="Code postal modifié">
                Le prix de livraison n’a pas été recalculé : vérifiez qu’il reste correct pour la nouvelle zone.
              </InlineAlert>
            )}
          </div>
        ) : (
          <form className="grid gap-4 sm:grid-cols-6" onSubmit={(event) => { event.preventDefault(); void save(); }} noValidate>
            <FormField label="Destinataire" required error={errorFor('fullName')} className="sm:col-span-6">
              <Input value={draft.fullName ?? ''} onChange={(event) => update({ fullName: event.target.value })} autoComplete="off" />
            </FormField>
            <FormField label={ADDRESS_FIELD_LABELS.street} required error={errorFor('street')} className="sm:col-span-4">
              <Input value={draft.street} onChange={(event) => update({ street: event.target.value })} autoComplete="off" />
            </FormField>
            <FormField label={ADDRESS_FIELD_LABELS.houseNumber} required error={errorFor('houseNumber')} hint="« s.n. » si pas de numéro" className="sm:col-span-2">
              <Input value={draft.houseNumber} onChange={(event) => update({ houseNumber: event.target.value })} autoComplete="off" />
            </FormField>
            <FormField label={ADDRESS_FIELD_LABELS.line2} optional error={errorFor('line2')} hint="Étage, interphone, bâtiment…" className="sm:col-span-6">
              <Input value={draft.line2} onChange={(event) => update({ line2: event.target.value })} autoComplete="off" />
            </FormField>
            <FormField label={ADDRESS_FIELD_LABELS.postalCode} required error={errorFor('postalCode')} className="sm:col-span-2">
              <Input value={draft.postalCode} onChange={(event) => update({ postalCode: event.target.value })} inputMode="text" autoComplete="off" />
            </FormField>
            <FormField label={ADDRESS_FIELD_LABELS.city} required error={errorFor('city')} className="sm:col-span-4">
              <Input value={draft.city} onChange={(event) => update({ city: event.target.value })} autoComplete="off" />
            </FormField>
            <FormField label="Téléphone du destinataire" optional hint="Laissé vide, l’ancien numéro est gardé." className="sm:col-span-3">
              <Input type="tel" value={phone} onChange={(event) => { setPhone(event.target.value); setError(null); }} autoComplete="off" />
            </FormField>
            <FormField label={ADDRESS_FIELD_LABELS.companyName} optional error={errorFor('companyName')} className="sm:col-span-3">
              <Input value={draft.companyName ?? ''} onChange={(event) => update({ companyName: event.target.value })} autoComplete="off" />
            </FormField>
            {error && <InlineAlert tone="danger" className="sm:col-span-6">{error}</InlineAlert>}
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </form>
        )}
      </Dialog>
    </>
  );
}
