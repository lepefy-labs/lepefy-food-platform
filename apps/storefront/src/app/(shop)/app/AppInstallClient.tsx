'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  IconCircleCheck, IconCopy, IconDeviceMobile, IconDotsVertical, IconDownload, IconMaximize,
  IconRefresh, IconShare2, IconSquarePlus,
} from '@tabler/icons-react';
import { appSourceFromParam, detectInstallContext, type AppSource, type InstallContext } from '@/lib/pwa/appInstall';
import { recordAppEvent, rememberAppSource } from '@/lib/pwa/recordAppEvent';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// L'invite native arrive en général tout de suite ; au-delà, on montre le geste manuel.
const PROMPT_WAIT_MS = 2500;

export function AppInstallClient({ tenantName, iconUrl }: { tenantName: string; iconUrl: string }) {
  const [context, setContext] = useState<InstallContext | null>(null);
  const [source, setSource] = useState<AppSource>('direct');
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [promptWaitOver, setPromptWaitOver] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const detected = detectInstallContext(navigator.userAgent, standalone, navigator.maxTouchPoints ?? 0);
    const from = appSourceFromParam(new URLSearchParams(window.location.search).get('src'));
    setContext(detected);
    setSource(from);
    rememberAppSource(from);
    recordAppEvent('install_page_view', from);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setAccepted(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    const timer = window.setTimeout(() => setPromptWaitOver(true), PROMPT_WAIT_MS);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.clearTimeout(timer);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    recordAppEvent('install_prompt', source);
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    if (outcome === 'accepted') {
      recordAppEvent('install_accepted', source);
      setAccepted(true);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Presse-papiers refusé : l'adresse reste affichée en clair.
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 pb-10 pt-8">
      <div className="text-center">
        {/* Icône réelle de l'application : celle que le client verra sur son écran d'accueil. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconUrl} alt="" width={88} height={88} className="mx-auto h-[88px] w-[88px] rounded-[22px] shadow-[0_8px_24px_rgba(17,24,39,0.18)]" />
        <h1 className="mt-5 text-2xl font-bold leading-tight text-gray-900">{tenantName} sur votre téléphone</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-700">
          Une icône sur votre écran d&apos;accueil pour retrouver la boutique en un geste. Gratuit, sans passer par un store.
        </p>
      </div>

      <section aria-live="polite" className="mt-7 min-h-[176px] rounded-2xl bg-white p-5 shadow-[0_2px_12px_rgba(17,24,39,0.08)] ring-1 ring-black/5">
        {accepted ? (
          <Done tenantName={tenantName} message={`C'est fait ! Retrouvez ${tenantName} sur votre écran d'accueil.`} />
        ) : context === null ? (
          <p className="pt-12 text-center text-sm text-gray-600">Un instant…</p>
        ) : context === 'installed' ? (
          <Done tenantName={tenantName} message="L'application est déjà installée : vous êtes dedans." />
        ) : prompt ? (
          <>
            <h2 className="text-base font-bold text-gray-900">Installer en un geste</h2>
            <p className="mt-1 text-sm text-gray-700">Votre navigateur s&apos;occupe de tout, cela prend deux secondes.</p>
            <PrimaryButton onClick={install} icon={<IconDownload size={20} aria-hidden />}>Installer l&apos;application</PrimaryButton>
          </>
        ) : context === 'in_app_browser' ? (
          <InAppBrowser onCopy={copyLink} copied={copied} ios={/iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent)} />
        ) : context === 'ios' ? (
          <Steps title="Sur iPhone, en 3 gestes" steps={[
            <>Touchez <Key icon={<IconShare2 size={16} aria-hidden />}>Partager</Key> dans la barre de Safari.</>,
            <>Choisissez <Key icon={<IconSquarePlus size={16} aria-hidden />}>Sur l&apos;écran d&apos;accueil</Key>. Faites défiler la liste si besoin.</>,
            <>Touchez <Key>Ajouter</Key> en haut à droite.</>,
          ]} />
        ) : context === 'android' ? (
          promptWaitOver ? (
            <Steps title="Sur Android, en 2 gestes" steps={[
              <>Touchez le menu <MenuKey /> en haut à droite de Chrome.</>,
              <>Choisissez <Key>Installer l&apos;application</Key> ou <Key>Ajouter à l&apos;écran d&apos;accueil</Key>.</>,
            ]} />
          ) : (
            <p className="pt-12 text-center text-sm text-gray-600">Préparation de l&apos;installation…</p>
          )
        ) : (
          <Desktop onCopy={copyLink} copied={copied} />
        )}
      </section>

      <ul className="mt-7 space-y-4">
        <Benefit icon={<IconDeviceMobile size={22} aria-hidden />} title="En un geste">
          L&apos;icône {tenantName} vous attend sur l&apos;écran d&apos;accueil, comme vos autres applications.
        </Benefit>
        <Benefit icon={<IconMaximize size={22} aria-hidden />} title="En plein écran">
          La boutique s&apos;ouvre sans la barre du navigateur, plus confortable pour commander.
        </Benefit>
        <Benefit icon={<IconRefresh size={22} aria-hidden />} title="Toujours à jour">
          Rien à télécharger ni à mettre à jour : vous voyez toujours les prix et le stock du jour.
        </Benefit>
      </ul>

      <div className="mt-8 text-center">
        <Link href="/" prefetch={false} className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-gray-700 underline underline-offset-4">
          Continuer sur le site
        </Link>
      </div>
    </div>
  );
}

function PrimaryButton({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{ backgroundColor: 'var(--color-primary)', '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
    >
      {icon}{children}
    </button>
  );
}

function Key({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-gray-100 px-1.5 py-0.5 align-middle text-[13px] font-semibold text-gray-900 ring-1 ring-gray-200">
      {icon}{children}
    </span>
  );
}

/** Bouton menu « trois points » : l'icône seule, le mot pour les lecteurs d'écran. */
function MenuKey() {
  return <Key icon={<IconDotsVertical size={16} aria-hidden />}><span className="sr-only">trois points</span></Key>;
}

function Steps({ title, steps }: { title: string; steps: React.ReactNode[] }) {
  return (
    <>
      <h2 className="text-base font-bold text-gray-900">{title}</h2>
      <ol className="mt-3 space-y-3">
        {steps.map((step, index) => (
          <li key={index} className="flex gap-3 text-[15px] leading-relaxed text-gray-800">
            <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
              {index + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function InAppBrowser({ onCopy, copied, ios }: { onCopy: () => void; copied: boolean; ios: boolean }) {
  return (
    <>
      <h2 className="text-base font-bold text-gray-900">Ouvrez d&apos;abord cette page dans {ios ? 'Safari' : 'Chrome'}</h2>
      <p className="mt-1 text-sm leading-relaxed text-gray-700">
        Vous êtes dans le navigateur d&apos;une autre application (e-mail, réseau social) : l&apos;installation n&apos;y est pas possible.
        {ios
          ? <> Touchez <Key>⋯</Key> ou l&apos;icône boussole, puis <Key>Ouvrir dans Safari</Key>.</>
          : <> Touchez le menu <MenuKey />, puis <Key>Ouvrir dans Chrome</Key>.</>}
      </p>
      <CopyButton onCopy={onCopy} copied={copied} label="Ou copiez le lien et collez-le dans le navigateur" />
    </>
  );
}

function Desktop({ onCopy, copied }: { onCopy: () => void; copied: boolean }) {
  return (
    <>
      <h2 className="text-base font-bold text-gray-900">Ouvrez cette page sur votre téléphone</h2>
      <p className="mt-1 text-sm leading-relaxed text-gray-700">
        L&apos;application s&apos;installe depuis le navigateur de votre téléphone : ouvrez ce lien dans l&apos;e-mail reçu, ou envoyez-le-vous.
      </p>
      <CopyButton onCopy={onCopy} copied={copied} label="Copier le lien" />
    </>
  );
}

function CopyButton({ onCopy, copied, label }: { onCopy: () => void; copied: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
    >
      {copied ? <IconCircleCheck size={18} aria-hidden /> : <IconCopy size={18} aria-hidden />}
      {copied ? 'Lien copié' : label}
    </button>
  );
}

function Done({ tenantName, message }: { tenantName: string; message: string }) {
  return (
    <div className="pt-4 text-center">
      <IconCircleCheck size={40} className="mx-auto text-emerald-600" aria-hidden />
      <p className="mt-2 text-[15px] font-semibold text-gray-900">{message}</p>
      <Link
        href="/"
        prefetch={false}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-bold text-white"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        Voir les produits de {tenantName}
      </Link>
    </div>
  );
}

function Benefit({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--color-primary)]" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, white)' }}>
        {icon}
      </span>
      <span>
        <span className="block text-[15px] font-bold text-gray-900">{title}</span>
        <span className="block text-sm leading-relaxed text-gray-700">{children}</span>
      </span>
    </li>
  );
}
