'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconBuildingStore, IconUserCircle, IconGift, IconMapPin, IconStar, IconAlertCircle, IconQrcode } from '@tabler/icons-react';
import type { Address } from '@lepefy/types';
import { ProfileEditModal } from './ProfileEditModal';
import { AddressFormModal } from './AddressFormModal';

interface AccountTenant {
  name:            string;
  logoUrl:         string | null;
  countriesServed: number | null;
  loyaltyEnabled:  boolean;
  country:         string;
}

interface AccountDashboardProps {
  tenant:          AccountTenant;
  email:           string;
  fullName:        string | null;
  phone:           string | null;
  confirmedPoints: number;
  addresses:       Address[];
  isAmbassador:              boolean;
  ambassadorProfileCompleted: boolean;
}

const pointsFormatter = new Intl.NumberFormat('fr-FR');

function sortAddresses(list: Address[]): Address[] {
  return [...list].sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });
}

function formatAddressLine(address: Address): string {
  const line1 = address.line2 ? `${address.line1}, ${address.line2}` : address.line1;
  return `${line1}, ${address.postal_code} ${address.city}`;
}

export function AccountDashboard({
  tenant, email, fullName, phone, confirmedPoints, addresses,
  isAmbassador, ambassadorProfileCompleted,
}: AccountDashboardProps) {
  const router = useRouter();

  const [profile, setProfile]           = useState({ fullName, phone });
  const [addressList, setAddressList]   = useState(() => sortAddresses(addresses));
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [addressModal, setAddressModal] = useState<'add' | Address | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
    } finally {
      setIsLoggingOut(false);
    }
  }

  function handleProfileSaved(next: { fullName: string | null; phone: string | null }) {
    setProfile(next);
    setIsProfileModalOpen(false);
    router.refresh();
  }

  function handleAddressSaved(saved: Address) {
    setAddressList((prev) => {
      const rest = prev.filter((a) => a.id !== saved.id).map((a) => (saved.is_default ? { ...a, is_default: false } : a));
      return sortAddresses([...rest, saved]);
    });
    setAddressModal(null);
    router.refresh();
  }

  function handleAddressDeleted(id: string) {
    setAddressList((prev) => sortAddresses(prev.filter((a) => a.id !== id)));
    setAddressModal(null);
    router.refresh();
  }

  return (
    <div className="min-h-screen flex justify-center px-4 py-8 sm:py-10" style={{ backgroundColor: '#f7f8f6' }}>
      <div
        className="w-full flex flex-col overflow-hidden rounded-[20px]"
        style={{ maxWidth: 430, boxShadow: '0 8px 30px rgba(20, 40, 30, 0.12)', backgroundColor: 'white' }}
      >
        <div style={{ height: 6, backgroundColor: 'var(--color-primary)' }} />

        {/* Header brand */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-gray-100">
          <div
            className="flex items-center justify-center shrink-0 overflow-hidden rounded-full"
            style={{ width: 32, height: 32, backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, white)' }}
          >
            {tenant.logoUrl ? (
              <Image src={tenant.logoUrl} alt={tenant.name} width={32} height={32} className="h-full w-full object-cover" />
            ) : (
              <IconBuildingStore size={16} stroke={1.8} color="var(--color-primary)" />
            )}
          </div>
          <span className="font-bold" style={{ fontSize: 14, color: 'var(--color-primary-dark)' }}>{tenant.name}</span>
        </div>

        {/* Identité */}
        <div className="text-center px-5 pt-6 pb-2">
          <div
            className="mx-auto mb-3 flex items-center justify-center rounded-full"
            style={{ width: 56, height: 56, backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, white)' }}
          >
            <IconUserCircle size={28} stroke={1.5} color="var(--color-primary)" />
          </div>
          <div className="font-extrabold text-gray-900" style={{ fontSize: 20 }}>Mon compte</div>
          <div className="text-gray-500 mt-1" style={{ fontSize: 13, lineHeight: 1.5 }}>
            Connecté(e) en tant que<br />
            <strong className="text-gray-700">{email}</strong>
          </div>
        </div>

        {/* Bannière ambassadeur — profil incomplet, ne bloque jamais la
            navigation (voir 046) : juste un rappel visible tant que le
            paiement des commissions n'est pas configurable. */}
        {isAmbassador && !ambassadorProfileCompleted && (
          <div className="mx-5 mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 flex items-start gap-2">
            <IconAlertCircle size={16} stroke={1.8} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-amber-800" style={{ fontSize: 12, lineHeight: 1.4 }}>
              Complète ton profil pour recevoir tes paiements —{' '}
              <Link href="/compte/ambassadeur" className="font-bold underline">
                c&apos;est ici
              </Link>
            </div>
          </div>
        )}

        {/* Points fidélité — uniquement si le programme est activé pour ce tenant.
            Pas de badge de niveau ni de barre de progression : aucun système de
            palier par points n'existe côté données (ledger + solde uniquement),
            voir le rapport final. */}
        {tenant.loyaltyEnabled && (
          <div className="px-5 pt-4">
            <div
              className="text-white"
              style={{
                background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))',
                borderRadius: 16,
                padding: 18,
              }}
            >
              <span style={{ fontSize: 12, opacity: 0.85 }}>Tes points fidélité</span>
              <div className="font-extrabold" style={{ fontSize: 32, marginTop: 2 }}>
                {pointsFormatter.format(confirmedPoints)} pts
              </div>
            </div>
            <Link
              href="/compte/carte-fidelite"
              className="mt-2.5 w-full flex items-center justify-center gap-2 font-bold rounded-xl border"
              style={{
                fontSize: 13,
                padding: '10px',
                color: 'var(--color-primary)',
                borderColor: 'color-mix(in srgb, var(--color-primary) 25%, white)',
              }}
            >
              <IconQrcode size={16} stroke={1.8} />
              Voir ma carte de fidélité
            </Link>
          </div>
        )}

        {/* Informations personnelles */}
        <div className="px-5 pt-[18px]">
          <div className="font-bold text-gray-500 uppercase mb-2" style={{ fontSize: 12, letterSpacing: '0.04em' }}>
            Informations personnelles
          </div>
          <div className="border border-gray-200 rounded-[14px] overflow-hidden">
            <div className="flex justify-between items-center px-3.5 py-[13px] border-b border-gray-100">
              <div>
                <div className="text-gray-500" style={{ fontSize: 11 }}>Nom</div>
                <div className="font-semibold text-gray-800" style={{ fontSize: 14 }}>
                  {profile.fullName || 'Non renseigné'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsProfileModalOpen(true)}
                className="font-bold shrink-0"
                style={{ fontSize: 12, color: 'var(--color-primary)' }}
              >
                Modifier
              </button>
            </div>
            <div className="flex justify-between items-center px-3.5 py-[13px]">
              <div>
                <div className="text-gray-500" style={{ fontSize: 11 }}>Téléphone</div>
                <div className="font-semibold text-gray-800" style={{ fontSize: 14 }}>
                  {profile.phone || 'Non renseigné'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsProfileModalOpen(true)}
                className="font-bold shrink-0"
                style={{ fontSize: 12, color: 'var(--color-primary)' }}
              >
                Modifier
              </button>
            </div>
          </div>
        </div>

        {/* Adresses de livraison */}
        <div className="px-5 pt-[18px]">
          <div className="flex justify-between items-center mb-2">
            <div className="font-bold text-gray-500 uppercase" style={{ fontSize: 12, letterSpacing: '0.04em' }}>
              Adresses de livraison
            </div>
            <button
              type="button"
              onClick={() => setAddressModal('add')}
              className="font-bold shrink-0"
              style={{ fontSize: 12, color: 'var(--color-primary)' }}
            >
              + Ajouter
            </button>
          </div>

          {addressList.length === 0 ? (
            <p className="text-gray-400 text-center py-4" style={{ fontSize: 13 }}>
              Aucune adresse enregistrée pour l&apos;instant.
            </p>
          ) : (
            <div className="border border-gray-200 rounded-[14px] overflow-hidden">
              {addressList.map((address, i) => (
                <button
                  key={address.id}
                  type="button"
                  onClick={() => setAddressModal(address)}
                  className={`w-full flex justify-between items-start gap-2 px-3.5 py-[13px] text-left hover:bg-gray-50 ${
                    i < addressList.length - 1 ? 'border-b border-gray-100' : ''
                  }`}
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <IconMapPin size={16} stroke={1.8} className="text-gray-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-800 truncate" style={{ fontSize: 14 }}>
                        {address.full_name}
                      </div>
                      <div className="text-gray-500 mt-0.5" style={{ fontSize: 12 }}>
                        {formatAddressLine(address)}
                      </div>
                    </div>
                  </div>
                  {address.is_default && (
                    <span
                      className="font-bold shrink-0 whitespace-nowrap rounded-md"
                      style={{
                        fontSize: 11,
                        padding: '3px 8px',
                        color: 'var(--color-primary)',
                        backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, white)',
                      }}
                    >
                      Par défaut
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="p-5 space-y-2.5">
          {isAmbassador && (
            <Link
              href="/compte/ambassadeur"
              className="w-full flex items-center justify-center gap-2 text-white font-bold rounded-xl"
              style={{ backgroundColor: 'var(--color-primary-dark)', fontSize: 15, padding: '14px' }}
            >
              <IconStar size={18} stroke={1.8} />
              Espace Ambassadeur
            </Link>
          )}
          <Link
            href="/compte/parrainage"
            className="w-full flex items-center justify-center gap-2 text-white font-bold rounded-xl"
            style={{ backgroundColor: 'var(--color-primary)', fontSize: 15, padding: '14px' }}
          >
            <IconGift size={18} stroke={1.8} />
            Invite un ami
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="w-full font-semibold text-gray-700 border border-gray-200 rounded-xl disabled:opacity-50"
            style={{ fontSize: 15, padding: '14px' }}
          >
            {isLoggingOut ? 'Déconnexion…' : 'Se déconnecter'}
          </button>
        </div>
      </div>

      {isProfileModalOpen && (
        <ProfileEditModal
          fullName={profile.fullName}
          phone={profile.phone}
          onClose={() => setIsProfileModalOpen(false)}
          onSaved={handleProfileSaved}
        />
      )}

      {addressModal && (
        <AddressFormModal
          address={addressModal === 'add' ? undefined : addressModal}
          defaultFullName={profile.fullName}
          defaultCountry={tenant.country}
          onClose={() => setAddressModal(null)}
          onSaved={handleAddressSaved}
          onDeleted={handleAddressDeleted}
        />
      )}
    </div>
  );
}
