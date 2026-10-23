'use client';

import { useState, type FormEvent } from 'react';
import { trackDemoEvent } from '@/components/demo/DemoTour';
import { DEMO_INTERESTS, DEMO_INTEREST_LABELS, validateDemoRequest, type DemoInterest } from '@/lib/demo/demoRequest';

const FIELD = 'w-full rounded-lg border border-a-field bg-a-surface px-3 py-2 text-sm text-a-text placeholder:text-a-text-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-brand';
const LABEL = 'flex flex-col gap-1 text-sm font-semibold text-a-text';

/** « Demander ma propre boutique » : formulaire court, consentement explicite, aucune réponse automatique. */
export default function DemoRequestPanel() {
  const [open, setOpen] = useState(false);
  const [interests, setInterests] = useState<DemoInterest[]>([]);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  function toggle(interest: DemoInterest) {
    setInterests((current) => current.includes(interest) ? current.filter((value) => value !== interest) : [...current, interest]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = {
      businessName: data.get('businessName'), city: data.get('city'), email: data.get('email'), phone: data.get('phone'),
      message: data.get('message'), interests, consent: data.get('consent') === 'on', website: data.get('website'),
    };
    const check = validateDemoRequest(body as Record<string, unknown>);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setStatus('sending');
    setError(null);
    try {
      const response = await fetch('/api/demo/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(json.error ?? 'La demande n’a pas pu être envoyée. Réessayez.');
        setStatus('idle');
        return;
      }
      setStatus('sent');
    } catch {
      setError('Connexion impossible. Vérifiez le réseau puis réessayez.');
      setStatus('idle');
    }
  }

  return (
    <section aria-labelledby="demo-request" className="flex flex-col gap-4 rounded-[10px] border border-a-border bg-a-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="demo-request" className="text-base font-semibold text-a-text">Vous voulez la même chose pour votre commerce ?</h2>
          <p className="text-sm text-a-text-2">Laissez-nous vos coordonnées : une personne de l’équipe Lepefy vous répond.</p>
        </div>
        {!open && status !== 'sent' && (
          <button
            type="button"
            onClick={() => { setOpen(true); trackDemoEvent('request.opened'); }}
            className="rounded-lg bg-a-brand px-4 py-2 text-sm font-semibold text-a-on-brand hover:bg-a-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-a-brand"
          >
            Demander ma propre boutique
          </button>
        )}
      </div>

      {status === 'sent' && (
        <p role="status" className="rounded-lg border border-tone-success-border bg-tone-success-bg px-3 py-2 text-sm text-tone-success-fg">
          Demande envoyée. Une personne de l’équipe Lepefy vous recontacte au moyen indiqué.
        </p>
      )}

      {open && status !== 'sent' && (
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <label className={LABEL}>Nom de votre commerce<input id="demo-business" name="businessName" required maxLength={160} className={FIELD} placeholder="Ex. Traiteur du Marché" /></label>
          <label className={LABEL}>Ville <span className="sr-only">(facultatif)</span><input id="demo-city" name="city" maxLength={120} className={FIELD} placeholder="Ex. Évry" /></label>
          <label className={LABEL}>E-mail<input id="demo-email" name="email" type="email" maxLength={254} className={FIELD} autoComplete="email" /></label>
          <label className={LABEL}>Téléphone<input id="demo-phone" name="phone" type="tel" maxLength={40} className={FIELD} autoComplete="tel" /></label>
          <p className="text-sm text-a-text-3 sm:col-span-2">Un e-mail ou un téléphone suffit.</p>
          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="text-sm font-semibold text-a-text">Ce qui vous intéresse (facultatif)</legend>
            <div className="flex flex-wrap gap-2">
              {DEMO_INTERESTS.map((interest) => (
                <label key={interest} className="inline-flex items-center gap-2 rounded-full border border-a-border px-3 py-1.5 text-sm text-a-text-2">
                  <input type="checkbox" checked={interests.includes(interest)} onChange={() => toggle(interest)} />
                  {DEMO_INTEREST_LABELS[interest]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className={`${LABEL} sm:col-span-2`}>Votre message (facultatif)<textarea id="demo-message" name="message" maxLength={1000} rows={3} className={FIELD} /></label>
          {/* Champ piège pour les robots : invisible et ignoré par les lecteurs d'écran. */}
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
          <label className="flex items-start gap-2 text-sm text-a-text-2 sm:col-span-2">
            <input id="demo-consent" name="consent" type="checkbox" className="mt-1" />
            <span>
              J’accepte que Lepefy utilise ces informations pour me recontacter au sujet de cette demande. Elles sont conservées 12 mois au plus
              et supprimées sur simple demande. Aucun envoi publicitaire.
            </span>
          </label>
          {error && <p role="alert" className="text-sm text-tone-danger-fg sm:col-span-2">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={status === 'sending'} className="rounded-lg bg-a-brand px-4 py-2 text-sm font-semibold text-a-on-brand hover:bg-a-brand-hover disabled:opacity-60">
              {status === 'sending' ? 'Envoi…' : 'Envoyer ma demande'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-a-border px-4 py-2 text-sm font-semibold text-a-text-2 hover:bg-a-surface-2">
              Annuler
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
