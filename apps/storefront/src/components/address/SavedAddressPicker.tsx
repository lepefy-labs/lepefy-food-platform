'use client';

import { countryLabel } from '@/lib/address/addressRules';
import { ADDRESS_COPY } from '@/lib/storefrontCopy/addressCopy';

export interface SavedAddress {
  id: string;
  full_name: string;
  line1: string;
  line2: string | null;
  city: string;
  postal_code: string;
  country: string;
  is_default: boolean;
}

export const NEW_ADDRESS = 'new';

/**
 * Adresses enregistrées du client, choisies d'un seul toucher (vrais boutons
 * radio : flèches du clavier, lecteurs d'écran). « Livrer à une autre
 * adresse » ouvre le formulaire vide.
 */
export function SavedAddressPicker({
  name,
  addresses,
  selected,
  onSelect,
  onEdit,
}: {
  name: string;
  addresses: SavedAddress[];
  selected: string;
  onSelect: (id: string) => void;
  onEdit?: (id: string) => void;
}) {
  const card = (active: boolean) =>
    `flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border-[1.5px] p-3.5 transition-colors ${active ? 'border-2' : ''}`;
  const cardStyle = (active: boolean) => (active
    ? { borderColor: 'var(--color-primary)', backgroundColor: 'color-mix(in srgb, var(--color-primary) 6%, white)' }
    : { borderColor: 'var(--field-border)', backgroundColor: '#fff' });

  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="sr-only">{ADDRESS_COPY.savedAddresses}</legend>
      {addresses.map((address) => {
        const active = selected === address.id;
        return (
          <div key={address.id} className="flex flex-col gap-1">
            <label className={card(active)} style={cardStyle(active)}>
              <input type="radio" name={name} value={address.id} checked={active} onChange={() => onSelect(address.id)}
                className="mt-0.5 h-5 w-5 shrink-0" style={{ accentColor: 'var(--color-primary)' }} />
              <span className="min-w-0 text-[15px] leading-snug text-gray-950">
                <span className="flex flex-wrap items-center gap-x-2 font-semibold">
                  {address.line1}
                  {address.is_default && (
                    <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-bold text-gray-800">{ADDRESS_COPY.defaultBadge}</span>
                  )}
                </span>
                {address.line2 && <span className="block text-sm text-gray-700">{address.line2}</span>}
                <span className="block text-sm text-gray-700">{address.postal_code} {address.city} · {countryLabel(address.country)}</span>
                <span className="block text-sm text-gray-700">{address.full_name}</span>
              </span>
            </label>
            {active && onEdit && (
              <button type="button" onClick={() => onEdit(address.id)}
                className="min-h-11 self-end px-1 text-sm font-bold text-[color:var(--color-primary-dark)] underline underline-offset-4">
                {ADDRESS_COPY.edit}
              </button>
            )}
          </div>
        );
      })}
      <label className={card(selected === NEW_ADDRESS)} style={cardStyle(selected === NEW_ADDRESS)}>
        <input type="radio" name={name} value={NEW_ADDRESS} checked={selected === NEW_ADDRESS} onChange={() => onSelect(NEW_ADDRESS)}
          className="mt-0.5 h-5 w-5 shrink-0" style={{ accentColor: 'var(--color-primary)' }} />
        <span className="text-[15px] leading-snug text-gray-950">
          <span className="block font-semibold">{ADDRESS_COPY.otherAddress}</span>
          <span className="block text-sm text-gray-700">{ADDRESS_COPY.otherAddressHint}</span>
        </span>
      </label>
    </fieldset>
  );
}
