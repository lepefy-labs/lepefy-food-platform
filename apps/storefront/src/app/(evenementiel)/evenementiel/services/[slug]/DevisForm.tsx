'use client';

import { useState } from 'react';
import { IconCircleCheck } from '@tabler/icons-react';

export default function DevisForm({ serviceSlug }: { serviceSlug: string }) {
  const [name, setName]       = useState('');
  const [email, setEmail]     = useState('');
  const [phone, setPhone]     = useState('');
  const [date, setDate]       = useState('');
  const [guests, setGuests]   = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [sent, setSent]       = useState(false);

  const inputClass =
    'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

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
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
          <IconCircleCheck size={26} className="text-green-600" />
        </div>
        <p className="font-semibold text-gray-900 mb-1">Demande envoyée !</p>
        <p className="text-sm text-gray-500">Notre équipe vous recontactera rapidement.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      <p className="text-sm font-semibold text-gray-700 mb-1">Demander un devis</p>

      <div className="grid grid-cols-2 gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom complet" className={inputClass} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" className={inputClass} />
      </div>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="Téléphone (optionnel)" className={inputClass} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Date souhaitée</label>
          <input value={date} onChange={(e) => setDate(e.target.value)} type="date" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Nombre d&apos;invités</label>
          <input
            value={guests}
            onChange={(e) => setGuests(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            placeholder="Ex. 30"
            className={inputClass}
          />
        </div>
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Décrivez votre événement, vos besoins…"
        rows={4}
        className={inputClass}
      />

      {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-4 py-3">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full py-3.5 rounded-2xl font-bold text-white text-sm disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        {isSubmitting ? 'Envoi…' : 'Envoyer la demande'}
      </button>
    </form>
  );
}
