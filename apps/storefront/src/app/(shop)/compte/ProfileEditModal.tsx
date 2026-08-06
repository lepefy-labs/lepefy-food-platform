'use client';

import { useState } from 'react';
import type { CountryCode } from 'libphonenumber-js';
import { formatPhoneLive, toE164 } from '@/lib/utils/phone';
import { Modal } from './Modal';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-1 block';

// Nombre minimal de chiffres saisis avant d'afficher un état invalide — évite
// que le champ passe en rouge dès la première touche pressée.
const MIN_DIGITS_BEFORE_VALIDATION = 3;

// Exemples de format par marché desservi (mêmes pays que la liste COUNTRIES
// de AddressFormModal.tsx, pas de préfixe fixe type "+33..." pour un tenant
// qui n'est pas français) — libphonenumber-js n'expose pas de générateur de
// numéro d'exemple sans un jeu de métadonnées additionnel, d'où cette petite
// table statique en repli.
const COUNTRY_PLACEHOLDER: Partial<Record<CountryCode, string>> = {
  IT: '+39 320 123 4567',
  FR: '+33 6 12 34 56 78',
  BE: '+32 470 12 34 56',
  DE: '+49 151 12345678',
  CH: '+41 78 123 45 67',
};
const FALLBACK_PLACEHOLDER = '+00 000 000 000';

interface ProfileEditModalProps {
  fullName:       string | null;
  phone:          string | null;
  defaultCountry: CountryCode;
  onClose:        () => void;
  onSaved:        (next: { fullName: string | null; phone: string | null }) => void;
}

export function ProfileEditModal({ fullName, phone, defaultCountry, onClose, onSaved }: ProfileEditModalProps) {
  const [name, setName]             = useState(fullName ?? '');
  const [phoneValue, setPhoneValue] = useState(phone ?? '');
  const [error, setError]           = useState<string | null>(null);
  const [isSaving, setIsSaving]     = useState(false);

  const phoneTrimmed = phoneValue.trim();
  const phoneDigits   = phoneTrimmed.replace(/\D/g, '').length;
  const phoneValidity: 'empty' | 'pending' | 'valid' | 'invalid' =
    phoneTrimmed.length === 0
      ? 'empty'
      : phoneDigits < MIN_DIGITS_BEFORE_VALIDATION
        ? 'pending'
        : toE164(phoneValue, defaultCountry)
          ? 'valid'
          : 'invalid';

  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPhoneValue(formatPhoneLive(e.target.value, defaultCountry));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0) {
      setError('Le nom ne peut pas être vide.');
      return;
    }

    let e164Phone: string | null = null;
    if (phoneTrimmed.length > 0) {
      e164Phone = toE164(phoneValue, defaultCountry);
      if (!e164Phone) {
        setError('Le numéro de téléphone est invalide.');
        return;
      }
    }

    setIsSaving(true);
    setError(null);
    try {
      const res  = await fetch('/api/customers/me', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fullName: name.trim(), phone: e164Phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de l\'enregistrement.');
        return;
      }
      onSaved({ fullName: data.fullName, phone: data.phone });
    } catch {
      setError('Erreur lors de l\'enregistrement.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Modal
        title="Informations personnelles"
        onClose={onClose}
        footer={
          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-2.5 rounded-xl font-semibold text-white text-sm disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {isSaving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        }
      >
        <div className="space-y-3">
          <div>
            <label className={LABEL_CLS}>Nom</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT_CLS}
              placeholder="Ton nom"
              autoFocus
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Téléphone</label>
            <input
              value={phoneValue}
              onChange={handlePhoneChange}
              type="tel"
              inputMode="tel"
              className={INPUT_CLS}
              placeholder={COUNTRY_PLACEHOLDER[defaultCountry] ?? FALLBACK_PLACEHOLDER}
            />
            {phoneValidity === 'invalid' && (
              <p className="text-red-500 mt-1" style={{ fontSize: 11 }}>Numéro de téléphone invalide.</p>
            )}
            {phoneValidity === 'valid' && (
              <p className="text-green-600 mt-1" style={{ fontSize: 11 }}>Numéro valide.</p>
            )}
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
        </div>
      </Modal>
    </form>
  );
}
