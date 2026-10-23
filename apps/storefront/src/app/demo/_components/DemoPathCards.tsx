'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconBuildingStore, IconCalendarEvent, IconChartBar, IconClipboardList, IconMessageChatbot, type Icon } from '@tabler/icons-react';
import { startDemoTour, trackDemoEvent } from '@/components/demo/DemoTour';
import type { DemoPathKey } from '@/lib/demo/tours';

interface PathCard { key: DemoPathKey; title: string; summary: string; minutes: number; admin: boolean; firstHref: string }

const ICONS: Record<DemoPathKey, Icon> = {
  shop: IconBuildingStore,
  events: IconCalendarEvent,
  orders: IconClipboardList,
  management: IconChartBar,
  nala: IconMessageChatbot,
};

export default function DemoPathCards({ paths }: { paths: PathCard[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<DemoPathKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(path: PathCard) {
    setError(null);
    if (!path.admin) {
      startDemoTour({ path: path.key, step: 0 });
      trackDemoEvent(`path.${path.key}`);
      router.push(path.firstHref);
      return;
    }
    setPending(path.key);
    try {
      const response = await fetch('/api/demo/visit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: path.key }),
      });
      const json = await response.json().catch(() => ({})) as { redirect?: string; error?: string };
      if (!response.ok || !json.redirect) {
        setError(json.error ?? 'La visite n’a pas pu s’ouvrir. Réessayez dans un instant.');
        setPending(null);
        return;
      }
      startDemoTour({ path: path.key, step: 0 });
      // Rechargement complet : la session visiteur vient d'être posée en cookie.
      window.location.assign(json.redirect);
    } catch {
      setError('Connexion impossible. Vérifiez le réseau puis réessayez.');
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {paths.map((path, index) => {
          const Icon = ICONS[path.key];
          return (
            <li key={path.key}>
              <button
                type="button"
                onClick={() => open(path)}
                disabled={pending !== null}
                className={`flex h-full w-full flex-col gap-2 rounded-[10px] border bg-a-surface p-4 text-left transition-colors hover:border-a-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-brand disabled:opacity-60 ${index === 0 ? 'border-a-brand' : 'border-a-border'}`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-a-brand-soft text-a-brand-fg">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className="text-base font-semibold text-a-text">{path.title}</span>
                <span className="text-sm text-a-text-2">{path.summary}</span>
                <span className="mt-auto pt-1 text-sm font-semibold text-a-brand-fg">
                  {pending === path.key ? 'Ouverture…' : path.admin ? `Visite en lecture seule · ${path.minutes} min →` : `Commencer · ${path.minutes} min →`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="text-sm text-tone-danger-fg">{error}</p>}
    </div>
  );
}
