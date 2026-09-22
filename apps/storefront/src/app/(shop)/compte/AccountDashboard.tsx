'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IconAlertCircle, IconChevronDown, IconChevronRight, IconGift, IconLogout,
  IconMapPin, IconPencil, IconPlus, IconReceipt, IconStar, IconTrash, IconUser, IconUserCircle,
} from '@tabler/icons-react';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import type { Address } from '@lepefy/types';
import type { LoyaltyBrand } from '@/lib/loyalty/wallet/brand';
import { referralDescription, type AccountOrderSummary, type AccountReferralSummary } from '@/lib/account/dashboard';
import { getCustomerOrderPresentation } from '@/lib/orders/orderStatus';
import { formatDate, formatPrice } from '@/lib/utils/format';
import { LoyaltyCardWidget } from './LoyaltyCardWidget';

export interface AccountDashboardProps {
  tenant: { name: string; loyaltyEnabled: boolean; currency: string };
  email: string;
  fullName: string | null;
  phone: string | null;
  confirmedPoints: number | null;
  addresses: Address[];
  isAmbassador: boolean;
  ambassadorProfileCompleted: boolean;
  loyaltyCardNumberDisplay: string | null;
  loyaltyBrand: LoyaltyBrand;
  walletAvailable: boolean;
  accountAccentForeground: string;
  latestOrder: AccountOrderSummary | null;
  errors: { points: boolean; addresses: boolean; orders: boolean };
  referral: AccountReferralSummary;
  reviewsAvailable: boolean;
}

interface NavigationRowProps {
  href: string; icon: TablerIcon; label: string; description: string;
}

function NavigationRow({ href, icon: Icon, label, description }: NavigationRowProps) {
  return (
    <Link href={href} className="group flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50 active:bg-gray-100">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ color: 'var(--account-accent-fg)', backgroundColor: 'var(--color-primary-light)' }}>
        <Icon size={21} stroke={1.7} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-gray-900">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-gray-500">{description}</span>
      </span>
      <IconChevronRight size={19} stroke={1.7} aria-hidden="true" className="shrink-0 text-gray-400" />
    </Link>
  );
}

function SectionError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm leading-6 text-amber-900">{message}</p>
      <button type="button" onClick={retry} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-amber-900 underline">
        Réessayer
      </button>
    </div>
  );
}

function LatestOrder({ order, error, currency, retry }: {
  order: AccountOrderSummary | null; error: boolean; currency: string; retry: () => void;
}) {
  const presentation = order ? getCustomerOrderPresentation(order.status, order.fulfillmentType) : null;
  return (
    <section aria-labelledby="orders-heading">
      <h2 id="orders-heading" className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-gray-900">
        <IconReceipt size={21} stroke={1.7} aria-hidden="true" /> Mes commandes
      </h2>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-card sm:p-5">
        {error ? <SectionError message="Vos commandes n’ont pas pu être chargées." retry={retry} /> : order && presentation ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-sm font-semibold text-gray-900">#{order.id.slice(0, 8).toUpperCase()}</p>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${presentation.stage === 'cancelled' ? 'bg-red-50 text-red-700' : 'bg-[var(--color-primary-light)] text-[var(--account-accent-fg)]'}`}>
                {presentation.label}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-gray-500">
              {formatDate(order.createdAt)} · {order.fulfillmentType === 'pickup' ? 'Retrait en boutique' : 'Livraison'} · {formatPrice(order.total, currency)}
            </p>
            <Link href={`/orders/${order.id}?token=${encodeURIComponent(order.trackingToken)}`}
              className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800">
              Voir la commande
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-gray-900">Votre premier achat vous attend</p>
            <p className="mt-1 text-sm leading-6 text-gray-500">Vous retrouverez ici vos prochaines commandes.</p>
            <Link href="/" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gray-800">
              Découvrir le catalogue <IconChevronRight size={17} aria-hidden="true" />
            </Link>
          </>
        )}
        <Link href="/orders" className="mt-3 flex min-h-11 items-center justify-between border-t border-gray-100 pt-3 text-sm font-medium text-gray-600">
          Toutes mes commandes <IconChevronRight size={17} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function AddressesSection({ addresses, error, retry }: { addresses: Address[]; error: boolean; retry: () => void }) {
  const [primaryAddress, ...otherAddresses] = addresses;
  function addressRow(address: Address) {
    return (
      <Link key={address.id} href={`/compte/adresses/${address.id}`}
        className="flex min-h-14 items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50">
        <IconMapPin size={20} stroke={1.7} aria-hidden="true" className="mt-1 shrink-0" style={{ color: 'var(--account-accent-fg)' }} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="break-words text-sm font-semibold text-gray-900">{address.full_name}</span>
            {address.is_default && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Par défaut</span>}
          </span>
          <span className="mt-1 block break-words text-xs leading-5 text-gray-500">
            {address.line1}{address.line2 ? ', ' + address.line2 : ''}<br />
            {address.postal_code} {address.city}, {address.country}
          </span>
        </span>
        <IconChevronRight size={18} stroke={1.7} aria-hidden="true" className="mt-1 shrink-0 text-gray-400" />
      </Link>
    );
  }
  return (
    <section aria-labelledby="addresses-heading">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h2 id="addresses-heading" className="font-display text-lg font-bold text-gray-900">Mes adresses</h2>
        <Link href="/compte/adresses/nouvelle" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-gray-700">
          <IconPlus size={18} stroke={1.8} aria-hidden="true" /> Ajouter
        </Link>
      </div>
      {error ? <SectionError message="Vos adresses n’ont pas pu être chargées." retry={retry} /> : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-card">
          {primaryAddress ? (
            <>
              {addressRow(primaryAddress)}
              {otherAddresses.length > 0 && <details className="group border-t border-gray-100">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-gray-600 [&::-webkit-details-marker]:hidden">
                  {otherAddresses.length} autre{otherAddresses.length > 1 ? 's' : ''} adresse{otherAddresses.length > 1 ? 's' : ''}
                  <IconChevronDown size={18} aria-hidden="true" className="transition-transform group-open:rotate-180" />
                </summary>
                <div className="divide-y divide-gray-100 border-t border-gray-100">{otherAddresses.map(addressRow)}</div>
              </details>}
            </>
          ) : (
            <Link href="/compte/adresses/nouvelle" className="flex min-h-16 items-center gap-3 px-4 py-4 text-sm leading-6 text-gray-600">
              <IconMapPin size={20} aria-hidden="true" className="shrink-0" />
              Ajoutez votre première adresse de livraison.
              <IconChevronRight size={18} aria-hidden="true" className="ml-auto shrink-0" />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

export function AccountDashboard({
  tenant, email, fullName, phone, confirmedPoints, addresses, isAmbassador, ambassadorProfileCompleted,
  loyaltyCardNumberDisplay, loyaltyBrand, walletAvailable, accountAccentForeground, latestOrder, errors, referral, reviewsAvailable,
}: AccountDashboardProps) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const retry = () => router.refresh();

  async function handleLogout() {
    setIsLoggingOut(true);
    setLogoutError(null);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Logout failed');
      const body = await response.json() as { ok?: boolean };
      if (body.ok !== true) throw new Error('Logout not confirmed');
      window.dispatchEvent(new Event('lepefy:customer-logged-out'));
      router.push('/');
      router.refresh();
    } catch {
      setLogoutError('La déconnexion a échoué. Réessayez dans un instant.');
    } finally { setIsLoggingOut(false); }
  }

  return (
    <div className="account-dashboard min-h-screen bg-[#f7f9f8]"
      style={{ '--account-accent-fg': accountAccentForeground } as CSSProperties}>
      <style>{`
        .account-dashboard :is(a, button, summary):focus-visible {
          outline: 2px solid var(--account-accent-fg);
          outline-offset: 3px;
        }
      `}</style>
      <div className="mx-auto w-full max-w-5xl px-4 pb-8 pt-5 sm:px-6 sm:pb-14 sm:pt-10">
        <header className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[56px_minmax(0,1fr)_auto]">
          <span className="flex h-10 w-10 items-center justify-center rounded-full sm:h-14 sm:w-14"
            style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--account-accent-fg)' }}>
            <IconUserCircle size={30} stroke={1.5} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Mon compte</p>
            <h1 className="break-words font-display text-lg font-bold text-gray-900 sm:text-2xl">{fullName ? 'Bonjour ' + fullName : 'Bienvenue !'}</h1>
            <p className="break-all text-xs leading-5 text-gray-500 sm:text-sm">{email}</p>
          </div>
          <Link href="/compte/modifier" className="inline-flex min-h-11 max-w-[112px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 sm:max-w-none sm:text-sm">
            <IconPencil size={17} aria-hidden="true" className="hidden shrink-0 sm:block" /> Modifier mon profil
          </Link>
        </header>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-x-8">
          {tenant.loyaltyEnabled && <section aria-labelledby="loyalty-heading" className="lg:col-start-1 lg:row-start-1">
            <h2 id="loyalty-heading" className="mb-3 font-display text-lg font-bold text-gray-900">Carte de fidélité</h2>
            <LoyaltyCardWidget brand={loyaltyBrand} fullName={fullName} confirmedPoints={confirmedPoints}
              cardNumberDisplay={loyaltyCardNumberDisplay} walletAvailable={walletAvailable} />
            {errors.points && <div className="mt-3"><SectionError message="Votre solde n’a pas pu être chargé." retry={retry} /></div>}
          </section>}

          <div className={tenant.loyaltyEnabled ? "lg:col-start-2 lg:row-start-1" : "lg:col-span-2"}>
            <LatestOrder order={latestOrder} error={errors.orders} currency={tenant.currency} retry={retry} />
          </div>

          <div className="space-y-5 lg:col-start-1 lg:row-start-2">
          <section aria-labelledby="benefits-heading">
            <h2 id="benefits-heading" className="mb-3 font-display text-lg font-bold text-gray-900">Mes avantages</h2>
            <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-card">
              <NavigationRow href="/compte/parrainage" icon={IconGift}
                label={referral.state === 'eligible' ? 'Inviter un ami' : 'Parrainage'}
                description={referralDescription(referral)} />
              {isAmbassador && <NavigationRow href="/compte/ambassadeur" icon={IconStar}
                label="Espace Ambassadeur" description="Mes invitations, commissions et paiements" />}
            </div>
            {isAmbassador && !ambassadorProfileCompleted && <Link href="/compte/ambassadeur"
              className="mt-3 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <IconAlertCircle size={19} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span className="text-sm leading-6"><strong className="block">Profil ambassadeur à compléter</strong>Complétez votre profil pour pouvoir recevoir vos paiements.</span>
              <IconChevronRight size={18} aria-hidden="true" className="mt-1 shrink-0" />
            </Link>}
          </section>
          {reviewsAvailable && (
            <section aria-labelledby="community-heading">
              <h2 id="community-heading" className="mb-3 font-display text-lg font-bold text-gray-900">La communauté</h2>
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-card">
                <NavigationRow href="/avis" icon={IconStar} label="Avis clients" description="Lire les avis vérifiés de la boutique" />
              </div>
            </section>
          )}
          </div>

          <div className="space-y-5 lg:col-start-2 lg:row-start-2">
            <section aria-labelledby="profile-heading">
              <h2 id="profile-heading" className="mb-3 font-display text-lg font-bold text-gray-900">Mes informations</h2>
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-card">
                <NavigationRow href="/compte/modifier" icon={IconUser} label="Profil et coordonnées"
                  description={phone ? 'Téléphone : ' + phone : 'Gérer mon nom et mes coordonnées'} />
              </div>
            </section>
            <AddressesSection addresses={addresses} error={errors.addresses} retry={retry} />
          </div>
        </div>

        <div className="mt-6 border-t border-gray-200 pt-4">
          <button type="button" onClick={handleLogout} disabled={isLoggingOut}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-gray-600 hover:bg-white disabled:cursor-wait disabled:opacity-50">
            <IconLogout size={19} stroke={1.7} aria-hidden="true" /> {isLoggingOut ? 'Déconnexion…' : 'Se déconnecter'}
          </button>
          {logoutError && <p role="alert" className="mt-2 text-sm text-red-700">{logoutError}</p>}
          <details className="group mt-3 rounded-xl border border-gray-200">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-gray-600 [&::-webkit-details-marker]:hidden">
              Gestion du compte <IconChevronDown size={18} aria-hidden="true" className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-gray-200 px-4 py-2">
              <Link href="/supprimer-compte" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-red-700">
                <IconTrash size={18} stroke={1.7} aria-hidden="true" /> Supprimer mon compte
              </Link>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
