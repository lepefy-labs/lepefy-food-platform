'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { IconChevronDown, IconChevronUp, IconInfoCircle, IconX } from '@tabler/icons-react';
import { DEMO_TOUR_STORAGE_KEY, demoPath, parseTourState, type DemoTourState } from '@/lib/demo/tours';

function readState(): DemoTourState | null {
  try {
    return parseTourState(window.sessionStorage.getItem(DEMO_TOUR_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeState(state: DemoTourState | null) {
  try {
    if (state) window.sessionStorage.setItem(DEMO_TOUR_STORAGE_KEY, JSON.stringify(state));
    else window.sessionStorage.removeItem(DEMO_TOUR_STORAGE_KEY);
  } catch {
    // Stockage indisponible (navigation privée) : la visite s'arrête, l'écran reste utilisable.
  }
}

export function trackDemoEvent(event: string) {
  try {
    void fetch('/api/demo/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }), keepalive: true });
  } catch {
    // Compteur best-effort.
  }
}

/** Démarre un parcours depuis la page d'accueil de la démo. */
export function startDemoTour(state: DemoTourState) {
  writeState(state);
}

/**
 * Visite guidée légère : un panneau en bas de l'écran, jamais un voile. On peut
 * le réduire ou le quitter ; l'écran réel reste utilisable à chaque étape.
 */
export default function DemoTour() {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<DemoTourState | null>(null);

  useEffect(() => { setState(readState()); }, [pathname]);

  const update = useCallback((next: DemoTourState | null) => {
    writeState(next);
    setState(next);
  }, []);

  if (!state) return null;
  const path = demoPath(state.path);
  if (!path) return null;
  const step = path.steps[state.step];
  if (!step) return null;
  const last = state.step === path.steps.length - 1;

  const go = (index: number) => {
    const target = path.steps[index];
    if (!target) return;
    update({ ...state, step: index, minimized: false });
    trackDemoEvent('tour.step');
    if (target.href && target.href !== pathname) router.push(target.href);
  };

  const close = (completed: boolean) => {
    trackDemoEvent(completed ? 'tour.completed' : 'tour.closed');
    update(null);
    if (completed) router.push('/demo');
  };

  return (
    <aside
      aria-label="Visite guidée de la démo"
      className="fixed right-3 z-[60] w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-violet-300 bg-white text-gray-900 shadow-xl"
      style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-1.5 sm:py-2">
        <p className="text-xs font-semibold text-violet-800">
          {path.title} · étape {state.step + 1} sur {path.steps.length}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => update({ ...state, minimized: !state.minimized })}
            className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600"
            aria-label={state.minimized ? 'Afficher la visite guidée' : 'Réduire la visite guidée'}
            aria-expanded={!state.minimized}
          >
            {state.minimized ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
          </button>
          <button
            type="button"
            onClick={() => close(false)}
            className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600"
            aria-label="Quitter la visite guidée"
          >
            <IconX size={18} />
          </button>
        </div>
      </div>
      {!state.minimized && (
        <div className="space-y-2 px-3 py-2.5 text-[13px] sm:py-3 sm:text-sm">
          <div className="max-h-[28vh] space-y-2 overflow-y-auto sm:max-h-none">
          <p className="font-semibold">{step.title}</p>
          <p className="text-gray-700">{step.body}</p>
          {step.gap && (
            <p className="flex gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[13px] text-amber-900">
              <IconInfoCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span><span className="font-semibold">Pas encore dans Lepefy : </span>{step.gap}</span>
            </p>
          )}
          </div>
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => go(state.step - 1)}
              disabled={state.step === 0}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40"
            >
              Précédent
            </button>
            {last ? (
              <button type="button" onClick={() => close(true)} className="rounded-lg bg-violet-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-800">
                Terminer
              </button>
            ) : (
              <button type="button" onClick={() => go(state.step + 1)} className="rounded-lg bg-violet-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-800">
                Suivant
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
