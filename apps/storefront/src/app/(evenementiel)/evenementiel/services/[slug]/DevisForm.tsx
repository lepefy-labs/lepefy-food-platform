'use client';

import { useEffect, useRef, useState } from 'react';
import { IconChevronDown, IconCircleCheck, IconSend } from '@tabler/icons-react';
import { applyCateringFormat, type CateringFormat } from '@/lib/events/cateringInquiry';

export default function DevisForm({ serviceSlug, selectedFormat, selectionVersion = 0, onSent }: {
  serviceSlug: string;
  selectedFormat?: CateringFormat;
  selectionVersion?: number;
  onSent?: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [date, setDate] = useState('');
  const [guests, setGuests] = useState('');
  const [message, setMessage] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!selectedFormat) return;
    setMessage((current) => applyCateringFormat(current, selectedFormat));
    setDetailsOpen(true);
  }, [selectedFormat, selectionVersion]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const inputClass = 'mt-1.5 w-full min-h-11 rounded-xl border border-black/10 bg-[#fffdf9] px-3.5 py-2.5 text-base text-gray-900 outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-60';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError('Indiquez votre nom et votre email pour recevoir une proposition.');
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
        setError(result.error ?? 'Votre demande n’a pas pu être envoyée. Veuillez réessayer.');
        return;
      }
      setSent(true);
      onSent?.();
    } catch {
      setError('Votre demande n’a pas pu être envoyée. Vos informations sont conservées ici : veuillez réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-3xl border border-black/[0.06] bg-white p-7 text-center shadow-xl" role="status" aria-live="polite">
        <IconCircleCheck size={42} className="mx-auto text-green-700" />
        <h2 className="mt-4 font-display text-2xl font-semibold text-gray-900">Votre demande est bien reçue</h2>
        <p className="mt-3 break-words text-sm leading-relaxed text-gray-600">Notre équipe vous recontactera à {email} pour échanger sur votre réception et préparer une proposition adaptée.</p>
        {(date || guests) && <p className="mt-4 rounded-xl bg-[#f7f3eb] p-3 text-sm text-gray-700">{date && 'Date souhaitée : ' + date}{date && guests && ' · '}{guests && guests + ' invités'}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-3xl border border-black/[0.06] bg-white p-5 text-gray-900 shadow-[0_18px_45px_rgba(50,37,20,.12)] sm:p-6" aria-labelledby="catering-form-title" aria-busy={isSubmitting}>
      <h2 id="catering-form-title" className="font-display text-2xl font-semibold">Votre devis personnalisé</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">Parlez-nous de votre réception. Vous pourrez préciser les détails avec notre équipe.</p>
      <p className="mt-3 text-xs text-gray-500">* Champs obligatoires</p>
      {selectedFormat && <p className="mt-3 rounded-xl bg-[#f7f3eb] px-3 py-2 text-sm font-medium">{selectedFormat}</p>}

      <div className="mt-4 grid gap-3">
        <label htmlFor="catering-name" className="text-xs font-medium text-gray-700">Nom complet *
          <input id="catering-name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" disabled={isSubmitting} className={inputClass} />
        </label>
        <label htmlFor="catering-email" className="text-xs font-medium text-gray-700">Email *
          <input id="catering-email" value={email} onChange={(e) => setEmail(e.target.value)} required type="email" autoComplete="email" disabled={isSubmitting} className={inputClass} />
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label htmlFor="catering-date" className="min-w-0 text-xs font-medium text-gray-700">Date souhaitée <span className="font-normal text-gray-500">(facultatif)</span>
          <input id="catering-date" value={date} onChange={(e) => setDate(e.target.value)} type="date" disabled={isSubmitting} className={inputClass} />
        </label>
        <label htmlFor="catering-guests" className="min-w-0 text-xs font-medium text-gray-700">Nombre d’invités <span className="font-normal text-gray-500">(facultatif)</span>
          <input id="catering-guests" value={guests} onChange={(e) => setGuests(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="Ex. 30" disabled={isSubmitting} className={inputClass} />
        </label>
      </div>

      <button type="button" onClick={() => setDetailsOpen((open) => !open)} disabled={isSubmitting} aria-expanded={detailsOpen} aria-controls="catering-details" className="mt-3 flex min-h-11 w-full items-center justify-between rounded-xl px-1 text-left text-sm font-semibold text-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
        {detailsOpen ? 'Masquer les précisions' : 'Ajouter des précisions (facultatif)'}
        <IconChevronDown size={18} className={detailsOpen ? 'rotate-180' : ''} />
      </button>
      <div id="catering-details" hidden={!detailsOpen} className="space-y-3">
        <label htmlFor="catering-phone" className="block text-xs font-medium text-gray-700">Téléphone <span className="font-normal text-gray-500">(facultatif)</span>
          <input id="catering-phone" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" disabled={isSubmitting} className={inputClass} />
        </label>
        <label htmlFor="catering-message" className="block text-xs font-medium text-gray-700">Votre projet <span className="font-normal text-gray-500">(facultatif)</span>
          <textarea id="catering-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type de réception, préférences culinaires, besoins particuliers…" rows={3} disabled={isSubmitting} className={inputClass + ' resize-y'} />
        </label>
      </div>

      {error && <p ref={errorRef} tabIndex={-1} className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 outline-none" role="alert">{error}</p>}
      <button type="submit" disabled={isSubmitting} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--color-primary-dark)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2">
        {isSubmitting ? 'Envoi en cours…' : 'Recevoir un devis personnalisé'} <IconSend size={17} />
      </button>
      <p className="mt-3 text-center text-xs leading-relaxed text-gray-500">Votre email nous permet de vous répondre au sujet de votre demande.</p>
    </form>
  );
}
