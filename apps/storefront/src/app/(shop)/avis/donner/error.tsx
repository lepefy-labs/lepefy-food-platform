'use client';

import { IconAlertCircle } from '@tabler/icons-react';

export default function ReviewError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <section role="alert" className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600"><IconAlertCircle size={24} aria-hidden="true" /></span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-950" style={{ fontFamily: 'var(--font-bricolage), var(--font-inter), system-ui, sans-serif' }}>Impossible de charger le formulaire</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Veuillez réessayer dans quelques instants.</p>
        <button type="button" onClick={reset} className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--color-primary)] px-5 text-sm font-semibold text-white hover:bg-[var(--color-primary-hover)]">Réessayer</button>
      </section>
    </div>
  );
}
