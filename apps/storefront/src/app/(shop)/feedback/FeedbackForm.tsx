'use client';

import { FormEvent, useRef, useState } from 'react';
import {
  CATEGORY_LABELS,
  FEEDBACK_CATEGORIES,
  FEEDBACK_REACTIONS,
  REACTION_EMOJI,
  REACTION_LABELS,
} from '@/lib/feedback/contracts';

type Props = {
  campaign: { headline: string; intro: string | null; thankYouMessage: string | null };
  accentColor: string;
};

export default function FeedbackForm({ campaign, accentColor }: Props) {
  const startedAt = useRef(Date.now());
  const [reaction, setReaction] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [contactAllowed, setContactAllowed] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setReaction(null);
    setCategory(null);
    setContactAllowed(false);
    setMessage('');
    setEmail('');
    setWebsite('');
    setError('');
    setSent(false);
    startedAt.current = Date.now();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          reaction,
          category,
          contactAllowed,
          contactEmail: contactAllowed ? email : null,
          website,
          dwellMs: Date.now() - startedAt.current,
          context: {
            pathname: window.location.pathname,
            language: navigator.language,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            standalone: window.matchMedia('(display-mode: standalone)').matches,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'Envoi impossible. Réessayez dans un instant.');
      setSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Envoi impossible. Réessayez dans un instant.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="py-8 text-center" role="status">
        <div className="text-5xl" aria-hidden="true">💛</div>
        <h1 className="mt-5 text-2xl font-bold text-gray-950">Merci pour votre retour !</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-gray-600">
          {campaign.thankYouMessage || 'Votre message nous aide à améliorer l’expérience.'}
        </p>
        <button type="button" onClick={reset} className="mt-7 rounded-xl border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50">
          Envoyer un autre feedback
        </button>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">{campaign.headline}</h1>
      {campaign.intro ? <p className="mt-3 text-sm leading-6 text-gray-600">{campaign.intro}</p> : null}
      <form onSubmit={submit} className="mt-8 space-y-7">
        <fieldset>
          <legend className="text-sm font-semibold text-gray-900">Comment s’est passée votre expérience ? <span className="font-normal text-gray-500">(facultatif)</span></legend>
          <div className="mt-3 grid grid-cols-5 gap-2">
            {FEEDBACK_REACTIONS.map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={reaction === value}
                onClick={() => setReaction(reaction === value ? null : value)}
                className="rounded-xl border px-1 py-2.5 text-center transition focus:outline-none focus:ring-2 focus:ring-offset-2"
                style={reaction === value ? { borderColor: accentColor, backgroundColor: accentColor, color: 'white' } : undefined}
              >
                <span className="block text-xl" aria-hidden="true">{REACTION_EMOJI[value]}</span>
                <span className="mt-1 block text-[11px] font-medium">{REACTION_LABELS[value]}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-gray-900">Votre retour concerne <span className="font-normal text-gray-500">(facultatif)</span></legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {FEEDBACK_CATEGORIES.map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={category === value}
                onClick={() => setCategory(category === value ? null : value)}
                className="rounded-full border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
                style={category === value ? { borderColor: accentColor, backgroundColor: accentColor, color: 'white' } : undefined}
              >
                {CATEGORY_LABELS[value]}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="text-base font-semibold text-gray-950">Dites-nous tout</span>
          <span className="mt-1 block text-sm text-gray-500">Ce qui vous a plu, ce qui vous a bloqué, ou ce que vous aimeriez voir.</span>
          <textarea
            required
            maxLength={4000}
            rows={7}
            value={message}
            onChange={event => setMessage(event.target.value)}
            className="mt-3 w-full resize-y rounded-2xl border border-gray-300 px-4 py-3 text-base text-gray-950 outline-none focus:ring-2"
            placeholder="Écrivez votre retour ici…"
          />
          <span className="mt-1 block text-right text-xs text-gray-400">{message.length}/4000</span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-gray-50 p-4">
          <input type="checkbox" checked={contactAllowed} onChange={event => setContactAllowed(event.target.checked)} className="mt-0.5 h-4 w-4" />
          <span className="text-sm text-gray-700">J’accepte d’être recontacté à propos de ce retour.</span>
        </label>

        {contactAllowed ? (
          <label className="block">
            <span className="text-sm font-semibold text-gray-900">Votre adresse e-mail</span>
            <input required type="email" maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-base" />
          </label>
        ) : null}

        <label className="absolute left-[-10000px]" aria-hidden="true">
          Site web
          <input tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} />
        </label>

        {error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
        <button
          type="submit"
          disabled={busy || !message.trim()}
          className="w-full rounded-2xl px-5 py-3.5 text-base font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: accentColor }}
        >
          {busy ? 'Envoi en cours…' : 'Envoyer mon feedback'}
        </button>
        <p className="text-center text-xs leading-5 text-gray-500">
          Votre message est utilisé uniquement pour améliorer le service. Votre e-mail n’est enregistré qu’avec votre accord.
        </p>
      </form>
    </>
  );
}
