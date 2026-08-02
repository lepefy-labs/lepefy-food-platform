'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconCopy, IconShare2, IconCheck, IconAlertCircle } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';

interface AmbassadorProfile {
  firstName: string | null;
  lastName: string | null;
  paymentMethod: 'IBAN' | 'PAYPAL' | null;
  iban: string | null;
  paypalEmail: string | null;
  completedAt: string | null;
}

interface InviteeRow {
  customerId: string;
  email: string;
  fullName: string | null;
  status: 'CONFIRMED' | 'PAID' | 'PENDING_THRESHOLD';
  commissionAmount: number;
}

interface AmbassadorClientProps {
  code: string | null;
  appUrl: string;
  currency: string;
  profile: AmbassadorProfile;
  confirmedBalance: number;
  paidTotal: number;
  invitees: InviteeRow[];
}

function maskIban(iban: string): string {
  if (iban.length <= 6) return iban;
  return `${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}`;
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain || !user) return email;
  const visible = user.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(user.length - 2, 2))}@${domain}`;
}

const STATUS_LABELS: Record<InviteeRow['status'], { label: string; cls: string }> = {
  CONFIRMED: { label: 'Commission confirmée', cls: 'text-green-600' },
  PAID: { label: 'Commission payée', cls: 'text-gray-500' },
  PENDING_THRESHOLD: { label: 'En attente de sa première commande', cls: 'text-amber-600' },
};

function ProfileForm({ onSaved }: { onSaved: (p: AmbassadorProfile) => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'IBAN' | 'PAYPAL'>('IBAN');
  const [iban, setIban] = useState('');
  const [paypalEmail, setPaypalEmail] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/customers/me/ambassador-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, paymentMethod, iban, paypalEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Une erreur est survenue.');
        return;
      }
      onSaved({
        firstName: data.ambassador_first_name,
        lastName: data.ambassador_last_name,
        paymentMethod: data.ambassador_payment_method,
        iban: data.ambassador_iban,
        paypalEmail: data.ambassador_paypal_email,
        completedAt: data.ambassador_profile_completed_at,
      });
    } finally {
      setIsSaving(false);
    }
  }

  const inputClass =
    'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" className={inputClass} required />
        <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom" className={inputClass} required />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setPaymentMethod('IBAN')}
          className={`flex-1 py-2.5 rounded-xl border text-sm font-medium ${
            paymentMethod === 'IBAN' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-gray-200 text-gray-600'
          }`}
        >
          Virement (IBAN)
        </button>
        <button
          type="button"
          onClick={() => setPaymentMethod('PAYPAL')}
          className={`flex-1 py-2.5 rounded-xl border text-sm font-medium ${
            paymentMethod === 'PAYPAL' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-gray-200 text-gray-600'
          }`}
        >
          PayPal
        </button>
      </div>

      {paymentMethod === 'IBAN' ? (
        <input
          value={iban}
          onChange={(e) => setIban(e.target.value)}
          placeholder="IBAN"
          className={inputClass}
          required
        />
      ) : (
        <input
          type="email"
          value={paypalEmail}
          onChange={(e) => setPaypalEmail(e.target.value)}
          placeholder="Email PayPal"
          className={inputClass}
          required
        />
      )}

      {error && <p className="text-red-500 text-xs">{error}</p>}

      <button
        type="submit"
        disabled={isSaving}
        className="w-full py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        {isSaving ? 'Enregistrement…' : 'Enregistrer mes informations de paiement'}
      </button>
    </form>
  );
}

export function AmbassadorClient({ code, appUrl, currency, profile: initialProfile, confirmedBalance, paidTotal, invitees }: AmbassadorClientProps) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [copied, setCopied] = useState(false);

  const shareUrl = code ? `${appUrl}/invite/${code}` : '';

  async function handleCopyLink() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    if (!shareUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Ton lien ambassadeur', url: shareUrl });
      } catch {
        // partage annulé par l'utilisateur
      }
    } else {
      await handleCopyLink();
    }
  }

  async function handleCopyValue(value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-sm mx-auto px-4 pt-8 pb-6 flex flex-col gap-6">
      <h1 className="text-xl font-bold text-gray-900 text-center">Espace Ambassadeur</h1>

      {!profile.completedAt && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2 text-sm text-amber-800">
          <IconAlertCircle size={18} stroke={1.8} className="flex-shrink-0 mt-0.5" />
          <span>Complète ton profil pour recevoir tes paiements — tes commissions continuent de s&apos;accumuler entre-temps.</span>
        </div>
      )}

      <div className="flex flex-col items-center gap-3 text-center">
        <div className="rounded-xl px-4 py-2 text-sm font-medium border border-gray-200">
          Ton code : {code ?? '…'}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-700"
          >
            {copied ? <IconCheck size={16} stroke={2} /> : <IconCopy size={16} stroke={1.7} />}
            {copied ? 'Copié !' : 'Copier'}
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <IconShare2 size={16} stroke={1.7} />
            Partager
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 px-4 py-4 space-y-2" style={{ boxShadow: 'var(--shadow-card)' }}>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Solde confirmé</span>
          <span className="font-bold text-gray-900">{formatPrice(confirmedBalance, currency)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Total déjà payé</span>
          <span className="font-medium text-gray-600">{formatPrice(paidTotal, currency)}</span>
        </div>
        <p className="text-[11px] text-gray-400 pt-1">
          Paiement toujours à l&apos;initiative de la boutique, une fois le seuil atteint.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-100 px-4 py-4" style={{ boxShadow: 'var(--shadow-card)' }}>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Mes informations de paiement</p>
        {profile.completedAt ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-gray-800 text-sm">
                {profile.firstName} {profile.lastName}
              </div>
              <div className="text-gray-500 text-sm mt-0.5">
                {profile.paymentMethod === 'IBAN' && profile.iban ? maskIban(profile.iban) : null}
                {profile.paymentMethod === 'PAYPAL' && profile.paypalEmail ? maskEmail(profile.paypalEmail) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopyValue(profile.paymentMethod === 'IBAN' ? (profile.iban ?? '') : (profile.paypalEmail ?? ''))}
              className="text-gray-400"
            >
              {copied ? <IconCheck size={18} stroke={2} /> : <IconCopy size={18} stroke={1.7} />}
            </button>
          </div>
        ) : (
          <ProfileForm onSaved={(p) => { setProfile(p); router.refresh(); }} />
        )}
      </div>

      <div className="rounded-2xl border border-gray-100 px-4 py-4" style={{ boxShadow: 'var(--shadow-card)' }}>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Mes invités</p>
        {invitees.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Partage ton lien pour commencer.</p>
        ) : (
          <div className="space-y-3">
            {invitees.map((inv) => (
              <div key={inv.customerId} className="flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium text-gray-800">{inv.fullName ?? inv.email}</div>
                  <div className={`text-xs ${STATUS_LABELS[inv.status].cls}`}>{STATUS_LABELS[inv.status].label}</div>
                </div>
                {inv.commissionAmount > 0 && (
                  <span className="font-semibold text-gray-700">{formatPrice(inv.commissionAmount, currency)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
