'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconAlertCircle, IconChevronRight, IconGift, IconLogout, IconMapPin, IconPencil, IconReceipt, IconStar, IconUser, IconUserCircle } from '@tabler/icons-react';
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
}

interface NavigationRowProps {
  href: string;
  icon: TablerIcon;
  label: string;
  description: string;
  accent?: boolean;
}

function formatAddressLine(address: Address): string {
  const street = address.line2 ? `${address.line1}, ${address.line2}` : address.line1;
  return `${street}, ${address.postal_code} ${address.city}`;
}

function NavigationRow({ href, icon: Icon, label, description, accent = false }: NavigationRowProps) {
  return (
    <Link
      href={href}
      className={`group flex min-h-16 items-center gap-3 px-4 py-3 transition-colors active:bg-gray-100 ${
        accent ? 'bg-primary-light/60 hover:bg-primary-light' : 'hover:bg-gray-50'
      }`}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ color: 'var(--color-primary-dark)', backgroundColor: accent ? 'white' : 'var(--color-primary-light)' }}
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

export function AccountDashboard({
  tenant, email, fullName, phone, confirmedPoints, addresses,
  isAmbassador, ambassadorProfileCompleted,
  loyaltyCardNumberDisplay, loyaltyCardBarcodeSvg, loyaltyCardTextColor,
}: AccountDashboardProps) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const defaultAddress = addresses.find((address) => address.is_default) ?? addresses[0] ?? null;
  const addressHref = defaultAddress ? `/compte/adresses/${defaultAddress.id}` : '/compte/adresses/nouvelle';
  const addressDescription = defaultAddress
    ? `${formatAddressLine(defaultAddress)}${addresses.length > 1 ? ` · ${addresses.length} adresses` : ''}`
    : 'Ajouter une adresse de livraison';
  const profileDescription = fullName || phone
    ? [fullName, phone].filter(Boolean).join(' · ')
    : 'Ajouter votre nom et votre téléphone';

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
    <div className="min-h-screen bg-[#f7f9f8]">
      <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-6 sm:px-6 sm:pb-14 sm:pt-10">
        <header className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-dark)' }}>
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

        {isAmbassador && !ambassadorProfileCompleted && (
          <Link href="/compte/ambassadeur" className="mt-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 transition-colors hover:bg-amber-100 active:bg-amber-100">
            <IconAlertCircle size={20} stroke={1.8} className="mt-0.5 shrink-0 text-amber-600" />
            <span className="flex-1 text-sm leading-5"><strong className="block font-semibold">Profil ambassadeur à compléter</strong>Ajoutez vos informations pour pouvoir recevoir vos paiements.</span>
            <IconChevronRight size={18} stroke={1.7} className="mt-1 shrink-0" aria-hidden="true" />
          </Link>
        )}

        {tenant.loyaltyEnabled && (
          <section className="mt-6" aria-labelledby="loyalty-heading">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Mes avantages</p>
                <h2 id="loyalty-heading" className="font-display text-lg font-bold text-gray-900">Carte de fidélité</h2>
              </div>
              <span className="text-xs font-medium" style={{ color: 'var(--color-primary-dark)' }}>Voir la carte</span>
            </div>
            <div className="max-w-lg">
              <LoyaltyCardWidget tenantName={tenant.name} fullName={fullName} confirmedPoints={confirmedPoints} cardNumberDisplay={loyaltyCardNumberDisplay} barcodeSvg={loyaltyCardBarcodeSvg} textColor={loyaltyCardTextColor} />
            </div>
          </section>
        )}

        <section className="mt-7" aria-labelledby="account-navigation-heading">
          <h2 id="account-navigation-heading" className="mb-3 font-display text-lg font-bold text-gray-900">Mon espace</h2>
          <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-card">
            <NavigationRow href="/orders" icon={IconReceipt} label="Mes commandes" description="Suivre et retrouver mes achats" />
            <NavigationRow href="/compte/modifier" icon={IconUser} label="Mes informations" description={profileDescription} />
            <NavigationRow href={addressHref} icon={IconMapPin} label="Mes adresses" description={addressDescription} />
            <NavigationRow href="/compte/parrainage" icon={IconGift} label="Inviter un ami" description="Partager mon lien de parrainage" accent />
            {isAmbassador && <NavigationRow href="/compte/ambassadeur" icon={IconStar} label="Espace Ambassadeur" description="Mes invitations, commissions et paiements" />}
          </div>
        </section>

        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          aria-label={isLoggingOut ? 'Déconnexion en cours' : 'Se déconnecter'}
          className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-white hover:text-gray-900 active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <IconLogout size={19} stroke={1.7} aria-hidden="true" />
          {isLoggingOut ? 'Déconnexion…' : 'Se déconnecter'}
        </button>
      </div>
    </div>
  );
}
