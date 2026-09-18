'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { IconArrowRight, IconCheck, IconLoader2, IconStar } from '@tabler/icons-react';

const ratingLabels = ['Très insatisfait', 'Insatisfait', 'Mitigé', 'Satisfait', 'Très satisfait'];

export default function ReviewForm({ orderId, token }: { orderId: string; token: string | null }) {
  const id = useId();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [ratingError, setRatingError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const firstStar = useRef<HTMLInputElement>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);

  useEffect(() => {
    if (done) successHeading.current?.focus();
  }, [done]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!rating) {
      setRatingError(true);
      firstStar.current?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: token ? null : orderId, token, rating, body: body.trim() || null }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'Impossible d’enregistrer votre avis.');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’enregistrer votre avis.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (done) return (
    <section aria-labelledby={id + '-success'} className="rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><IconCheck size={24} aria-hidden="true" /></span>
      <h2 id={id + '-success'} ref={successHeading} tabIndex={-1} className="mt-4 text-2xl font-bold tracking-tight text-slate-950" style={{ fontFamily: 'var(--font-bricolage), var(--font-inter), system-ui, sans-serif' }}>Merci !</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">Votre avis a bien été enregistré.</p>
      <Link href="/avis" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--color-primary)] px-5 text-sm font-semibold text-white hover:bg-[var(--color-primary-hover)]">Voir les avis</Link>
    </section>
  );

  return (
    <form onSubmit={submit} aria-busy={pending} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-7">
      <fieldset disabled={pending} aria-describedby={id + '-rating-feedback'} aria-invalid={ratingError || undefined}>
        <legend className="text-sm font-semibold text-slate-950">Votre note <span className="font-normal text-slate-600">(obligatoire)</span></legend>
        <p className="mt-2 text-sm text-slate-600">Comment s’est passée votre expérience ?</p>
        <div className="mx-auto mt-4 grid max-w-xs grid-cols-5 gap-1 sm:gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <label key={value} className="relative block min-w-0 cursor-pointer">
              <input
                ref={value === 1 ? firstStar : undefined}
                type="radio"
                name={id + '-rating'}
                value={value}
                checked={rating === value}
                aria-label={value + ' étoile' + (value > 1 ? 's' : '') + ' — ' + ratingLabels[value - 1]}
                className="peer sr-only"
                onChange={() => { setRating(value); setRatingError(false); }}
              />
              <span className={'flex h-12 w-full items-center justify-center rounded-xl border transition-colors motion-reduce:transition-none peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-primary)] peer-disabled:cursor-wait peer-disabled:opacity-60 ' + (value <= rating ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-300 bg-white text-slate-500 hover:border-amber-300 hover:bg-amber-50')}>
                <IconStar size={28} fill={value <= rating ? '#fbbf24' : 'none'} aria-hidden="true" />
              </span>
            </label>
          ))}
        </div>
        <div id={id + '-rating-feedback'} className="mt-3 min-h-5 text-center text-sm">
          {ratingError
            ? <p role="alert" className="font-medium text-red-700">Choisissez une note de 1 à 5 étoiles.</p>
            : <p aria-live="polite" className={rating ? 'font-medium text-slate-800' : 'text-slate-600'}>{rating ? rating + ' / 5 — ' + ratingLabels[rating - 1] : 'Sélectionnez une note de 1 à 5'}</p>}
        </div>
      </fieldset>

      <div className="mt-6">
        <label htmlFor={id + '-body'} className="text-sm font-semibold text-slate-950">Votre expérience <span className="font-normal text-slate-600">(facultatif)</span></label>
        <textarea
          id={id + '-body'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={pending}
          maxLength={2000}
          rows={4}
          aria-describedby={id + '-body-help ' + id + '-body-count'}
          placeholder="Qu’avez-vous apprécié ? Que pouvons-nous améliorer ?"
          className="mt-2 block w-full resize-y rounded-xl border border-slate-300 px-3 py-3 text-base leading-6 text-slate-950 placeholder:text-slate-500 focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-light)] disabled:opacity-60"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span id={id + '-body-help'}>Une note seule suffit.</span>
          <span id={id + '-body-count'} className="tabular-nums">{body.length} / 2000</span>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
          <p className="font-medium">{error}</p>
          <p>Votre texte est conservé. Vous pouvez réessayer.</p>
        </div>
      )}

      <button type="submit" disabled={pending} className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-5 py-3 text-sm font-bold text-white hover:bg-[var(--color-primary-hover)] disabled:cursor-wait disabled:opacity-60">
        {pending ? <><IconLoader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Envoi en cours…</> : <>Envoyer mon avis <IconArrowRight size={18} aria-hidden="true" /></>}
      </button>
    </form>
  );
}
