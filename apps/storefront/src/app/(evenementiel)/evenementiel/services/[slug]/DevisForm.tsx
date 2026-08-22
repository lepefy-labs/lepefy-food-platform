'use client';

import { useState } from 'react';
import { IconCircleCheck } from '@tabler/icons-react';

export default function DevisForm({ serviceSlug }: { serviceSlug: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [date, setDate] = useState('');
  const [guests, setGuests] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const inputClass = 'w-full min-h-11 rounded-xl border border-black/10 bg-[#fffdf9] px-3.5 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-primary)_18%,transparent)]';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !email.trim()) {
      setError('Nom et email sont obligatoires.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/services/${serviceSlug}/inquiry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: name.trim(),
          customer_email: email.trim(),
          customer_phone: phone.trim() || null,
          date_souhaitee: date || null,
          nombre_invites: guests ? Number(guests) : null,
          message: message.trim() || null,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        setError(result.error ?? 'Une erreur est survenue.');
        return;
      }
      setSent(true);
    } catch {
      setError('Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-3xl border border-black/[0.06] bg-white p-7 text-center shadow-[0_18px_45px_rgba(50,37,20,.08)]" role="status">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-green-100">
          <IconCircleCheck size={28} className="text-green-700" />
        </div>
        <p className="font-display text-2xl font-semibold text-gray-900">Demande envoyée</p>
        <p className="mt-2 text-sm text-gray-500">Notre équipe reviendra vers vous avec les prochaines étapes.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-3xl border border-black/[0.06] bg-white p-5 shadow-[0_18px_45px_rgba(50,37,20,.08)] sm:p-6">
      <div className="mb-5">
        <p className="font-display text-2xl font-semibold text-gray-900">Demander un devis</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">Quelques informations suffisent pour démarrer.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-gray-600">
          Nom complet *
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={`${inputClass} mt-1.5`} />
        </label>
        <label className="text-xs font-medium text-gray-600">
          Email *
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" className={`${inputClass} mt-1.5`} />
        </label>
      </div>

      <label className="mt-3 block text-xs font-medium text-gray-600">
        Téléphone
        <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" className={`${inputClass} mt-1.5`} />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-gray-600">
          Date souhaitée
          <input value={date} onChange={(e) => setDate(e.target.value)} type="date" className={`${inputClass} mt-1.5`} />
        </label>
        <label className="text-xs font-medium text-gray-600">
          Nombre d&apos;invités
          <input value={guests} onChange={(e) => setGuests(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="Ex. 30" className={`${inputClass} mt-1.5`} />
        </label>
      </div>

      <label className="mt-3 block text-xs font-medium text-gray-600">
        Votre projet
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Décrivez votre événement, vos besoins…" rows={5} className={`${inputClass} mt-1.5 min-h-[130px] resize-y`} />
      </label>

      {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-5 min-h-11 w-full rounded-xl bg-[var(--color-primary)] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--color-primary-dark)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
      >
        {isSubmitting ? 'Envoi…' : 'Envoyer ma demande'}
      </button>
    </form>
  );
}
