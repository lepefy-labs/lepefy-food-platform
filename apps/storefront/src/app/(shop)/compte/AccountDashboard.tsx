'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronRight,
  IconGift,
  IconLogout,
  IconMapPin,
  IconPencil,
  IconPlus,
  IconReceipt,
  IconStar,
  IconUser,
  IconUserCircle,
} from '@tabler/icons-react';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import type { Address } from '@lepefy/types';
import { LoyaltyCardWidget } from './LoyaltyCardWidget';

interface AccountDashboardProps {
  tenant: { name: string; loyaltyEnabled: boolean };
  email: string;
  fullName: string | null;
  phone: string | null;
  confirmedPoints: number;
  addresses: Address[];
  isAmbassador: boolean;
  ambassadorProfileCompleted: boolean;
  loyaltyCardNumberDisplay: string | null;
  loyaltyCardBarcodeSvg: string | null;
  loyaltyCardTextColor: string;
  accountAccentForeground: string;
}

interface NavigationRowProps {
  href: string;
  icon: TablerIcon;
  label: string;
  description: string;
}

function formatAddressLine(address: Address): string {
  const street = address.line2 ? `${address.line1}, ${address.line2}` : address.line1;
  return `${street}, ${address.postal_code} ${address.city}`;
}

function NavigationRow({ href, icon: Icon, label, description }: NavigationRowProps) {
  return (
    <Link
      href={href}
      className="group flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-gray-50 active:bg-gray-100"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ color: 'var(--account-accent-fg)', backgroundColor: 'var(--color-primary-light)' }}
      >
        <Icon size={21} stroke={1.7} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-gray-900">{label}</span>
        <span className="mt-0.5 block truncate text-xs leading-5 text-gray-500">{description}</span>
      </span>
      <IconChevronRight size={19} stroke={1.7} aria-hidden="true" className="shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function AddressRow({ address }: { address: Address }) {
  return (
    <Link
      href={`/compte/adresses/${address.id}`}
      className="group flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-gray-50 active:bg-gray-100"
    >
      <IconMapPin size={20} stroke={1.7} aria-hidden="true" className="shrink-0" style={{ color: 'var(--account-accent-fg)' }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-gray-900">{address.full_name}</span>
          {address.is_default && <span className="shrink-0 text-2xs font-semibold uppercase tracking-wide text-gray-500">Par défaut</span>}
        </span>
        <span className="mt-0.5 block truncate text-xs text-gray-500">{formatAddressLine(address)}</span>
      </span>
      <IconChevronRight size={18} stroke={1.7} aria-hidden="true" className="shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function AddressesSection({ addresses }: { addresses: Address[] }) {
  const [primaryAddress, ...otherAddresses] = addresses;

  return (
    <section className="mt-6" aria-labelledby="addresses-heading">
      <div className="mb-2 flex min-h-11 items-center justify-between gap-4">
        <h2 id="addresses-heading" className="font-display text-lg font-bold text-gray-900">Mes adresses</h2>
        <Link href="/compte/adresses/nouvelle" className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-gray-700 hover:text-gray-900">
          <IconPlus size={18} stroke={1.8} aria-hidden="true" />
          Ajouter
        </Link>
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-card">
        {primaryAddress ? (
          <>
            <AddressRow address={primaryAddress} />
            {otherAddresses.length > 0 && (
              <details className="group/details border-t border-gray-100">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
                  {otherAddresses.length} autre{otherAddresses.length > 1 ? 's' : ''} adresse{otherAddresses.length > 1 ? 's' : ''}
                  <IconChevronDown size={18} stroke={1.7} aria-hidden="true" className="transition-transform group-open/details:rotate-180" />
                </summary>
                <div className="divide-y divide-gray-100 border-t border-gray-100">
                  {otherAddresses.map((address) => <AddressRow key={address.id} address={address} />)}
                </div>
              </details>
            )}
          </>
        ) : (
          <Link href="/compte/adresses/nouvelle" className="flex min-h-16 items-center gap-3 px-4 py-3 text-sm text-gray-600 transition-colors hover:bg-gray-50 active:bg-gray-100">
            <IconMapPin size={20} stroke={1.7} aria-hidden="true" style={{ color: 'var(--account-accent-fg)' }} />
            <span className="flex-1">Ajoutez une adresse de livraison</span>
            <IconChevronRight size={18} stroke={1.7} aria-hidden="true" className="text-gray-400" />
          </Link>
        )}
      </div>
    </section>
  );
}

export function AccountDashboard({
  tenant, email, fullName, confirmedPoints, addresses,
  isAmbassador, ambassadorProfileCompleted,
  loyaltyCardNumberDisplay, loyaltyCardBarcodeSvg, loyaltyCardTextColor, accountAccentForeground,
}: AccountDashboardProps) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.dispatchEvent(new Event('lepefy:customer-logged-out'));
      router.push('/');
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div
      className="account-dashboard min-h-screen bg-[#f7f9f8]"
      style={{ '--account-accent-fg': accountAccentForeground } as CSSProperties}
    >
      <style>{`
        .account-dashboard :is(a, button, summary):focus-visible {
          outline: 2px solid var(--account-accent-fg);
          outline-offset: 2px;
        }
      `}</style>
      <div className="mx-auto w-full max-w-5xl px-4 pb-8 pt-5 sm:px-6 sm:pb-14 sm:pt-10">
        <header className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--account-accent-fg)' }}>
            <IconUserCircle size={32} stroke={1.5} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Mon compte</p>
            <h1 className="truncate font-display text-xl font-bold text-gray-900 sm:text-2xl">{fullName || 'Bienvenue !'}</h1>
            <p className="truncate text-sm text-gray-500">{email}</p>
          </div>
          <Link href="/compte/modifier" aria-label="Modifier mes informations" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 active:bg-gray-100">
            <IconPencil size={19} stroke={1.7} aria-hidden="true" />
          </Link>
        </header>

        <div className={`mt-5 grid items-start gap-5 lg:gap-8 ${tenant.loyaltyEnabled ? 'lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]' : ''}`}>
          {tenant.loyaltyEnabled && (
            <section aria-labelledby="loyalty-heading">
              <div className="mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Mes avantages</p>
                <h2 id="loyalty-heading" className="font-display text-lg font-bold text-gray-900">
                  Carte de fidélité
                </h2>
              </div>
              <div className="max-w-lg">
                <LoyaltyCardWidget tenantName={tenant.name} fullName={fullName} confirmedPoints={confirmedPoints} cardNumberDisplay={loyaltyCardNumberDisplay} barcodeSvg={loyaltyCardBarcodeSvg} textColor={loyaltyCardTextColor} />
              </div>
            </section>
          )}

          <div>
            {isAmbassador && !ambassadorProfileCompleted && (
              <Link href="/compte/ambassadeur" className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-100 bg-amber-50/60 px-3.5 py-2.5 text-amber-900 transition-colors hover:bg-amber-50 active:bg-amber-100">
                <IconAlertCircle size={18} stroke={1.7} className="mt-0.5 shrink-0 text-amber-500" />
                <span className="flex-1 text-sm leading-5">
                  <strong className="block font-semibold">Profil ambassadeur à compléter</strong>
                  Ajoutez vos informations pour pouvoir recevoir vos paiements.
                </span>
                <IconChevronRight size={18} stroke={1.7} className="mt-1 shrink-0" aria-hidden="true" />
              </Link>
            )}

            <section aria-labelledby="account-navigation-heading">
              <h2 id="account-navigation-heading" className="mb-2 font-display text-lg font-bold text-gray-900">Mon espace</h2>
              <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-card">
                <NavigationRow href="/orders" icon={IconReceipt} label="Mes commandes" description="Suivre et retrouver mes achats" />
                <NavigationRow href="/compte/modifier" icon={IconUser} label="Mes informations" description="Profil et coordonnées" />
                <NavigationRow href="/compte/parrainage" icon={IconGift} label="Inviter un ami" description="Partager mon lien de parrainage" />
                {isAmbassador && <NavigationRow href="/compte/ambassadeur" icon={IconStar} label="Espace Ambassadeur" description="Mes invitations, commissions et paiements" />}
              </div>
            </section>

            <AddressesSection addresses={addresses} />

            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              aria-label={isLoggingOut ? 'Déconnexion en cours' : 'Se déconnecter'}
              className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-white hover:text-gray-900 active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconLogout size={19} stroke={1.7} aria-hidden="true" />
              {isLoggingOut ? 'Déconnexion…' : 'Se déconnecter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
