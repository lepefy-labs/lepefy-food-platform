'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconArrowLeft } from '@tabler/icons-react';
import type { CountryCode } from 'libphonenumber-js';
import { formatPhoneLive, toE164 } from '@/lib/utils/phone';
import { TextField } from '@/components/ui/form';


// Nombre minimal de chiffres saisis avant d'afficher un état invalide — évite
// que le champ passe en rouge dès la première touche pressée.
const MIN_DIGITS_BEFORE_VALIDATION = 3;

// Exemples de format par marché desservi (mêmes pays que la liste COUNTRIES
// de AdresseFormClient.tsx, pas de préfixe fixe type "+33..." pour un tenant
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

interface ModifierProfilClientProps {
  fullName:       string | null;
  phone:          string | null;
  defaultCountry: CountryCode;
}

export function ModifierProfilClient({ fullName, phone, defaultCountry }: ModifierProfilClientProps) {
  const router = useRouter();
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
      router.push('/compte');
    } catch {
      setError('Erreur lors de l\'enregistrement.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex justify-center px-4 py-8 sm:py-10" style={{ backgroundColor: '#f7f8f6' }}>
      <div className="w-full flex flex-col gap-4" style={{ maxWidth: 430 }}>
        <Link href="/compte" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-gray-700">
          <IconArrowLeft size={16} stroke={1.8} />
          Mon compte
        </Link>

        <div
          className="w-full flex flex-col overflow-hidden rounded-[20px] border border-gray-200 bg-white"
        >
          <div className="px-5 pt-5 pb-4 border-b border-gray-100">
            <h1 className="font-display text-lg font-bold text-gray-950">Informations personnelles</h1>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-5 pt-5 pb-6">
            <TextField
              label="Nom et prénom"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Ex. : Marie Kamga"
              autoFocus
            />
            <TextField
              label="Téléphone"
              value={phoneValue}
              onChange={handlePhoneChange}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={`Ex. : ${COUNTRY_PLACEHOLDER[defaultCountry] ?? FALLBACK_PLACEHOLDER}`}
              hint="Avec l'indicatif du pays. Le livreur peut vous appeler."
              error={phoneValidity === 'invalid' ? "Vérifiez le numéro de téléphone, avec l'indicatif du pays." : null}
              message={phoneValidity === 'valid' ? { tone: 'success', text: 'Numéro valide.' } : null}
            />
            {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800" role="alert">{error}</p>}

            <button
              type="submit"
              disabled={isSaving}
              className="min-h-[52px] w-full rounded-2xl text-base font-bold text-white disabled:opacity-60"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {isSaving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
