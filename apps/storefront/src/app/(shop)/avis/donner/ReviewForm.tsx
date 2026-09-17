'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IconCheck, IconStar } from '@tabler/icons-react';

export default function ReviewForm({ orderId, token }: { orderId: string; token: string | null }) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!rating) { setError('Choisissez une note de 1 à 5 étoiles.'); return; }
    setPending(true); setError(null);
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
    } finally { setPending(false); }
  }

  if (done) return (
    <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-emerald-700"><IconCheck size={24} /></span>
      <h2 className="mt-4 text-xl font-bold text-gray-950">Merci pour votre avis</h2>
      <p className="mt-2 text-sm leading-6 text-gray-600">Il est maintenant en modération. La note n’influence jamais la décision de publication.</p>
      <Link href="/avis" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-gray-950 px-5 text-sm font-semibold text-white">Voir les avis</Link>
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-6 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
      <div>
        <p className="text-sm font-semibold text-gray-950">Votre note</p>
        <div className="mt-3 flex gap-1" role="radiogroup" aria-label="Note sur 5">
          {[1,2,3,4,5].map((value) => <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} étoile${value > 1 ? 's' : ''}`} onClick={() => setRating(value)} className="flex h-12 w-12 items-center justify-center rounded-xl hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"><IconStar size={30} fill={value <= rating ? 'currentColor' : 'none'} className={value <= rating ? 'text-amber-500' : 'text-gray-300'} /></button>)}
        </div>
      </div>
      <label className="block">
        <span className="text-sm font-semibold text-gray-950">Votre expérience <span className="font-normal text-gray-400">(facultatif)</span></span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={6} placeholder="Service, accueil, livraison, retrait…" className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-light)]" />
        <span className="mt-1 block text-right text-xs text-gray-400">{body.length}/2000</span>
      </label>
      <p className="rounded-2xl bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-500">Cet avis est lié à une commande payée et terminée. Il sera vérifié avant publication. Une note négative n’est jamais, à elle seule, un motif de rejet.</p>
      {error && <p role="alert" className="text-sm font-medium text-red-600">{error}</p>}
      <button disabled={pending} className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-[var(--color-primary)] px-5 text-sm font-bold text-white disabled:opacity-50">{pending ? 'Envoi…' : 'Envoyer mon avis'}</button>
    </form>
  );
}
