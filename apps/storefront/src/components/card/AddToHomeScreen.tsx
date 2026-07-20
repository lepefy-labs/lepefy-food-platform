'use client';

import { useState, useEffect } from 'react';
import { IconDeviceMobilePlus, IconShare, IconX } from '@tabler/icons-react';

type Lang = 'fr' | 'it';

const COPY: Record<Lang, {
  addToHome: string;
  addToHomeIos: string;
}> = {
  fr: {
    addToHome: 'Ajouter à l\'écran d\'accueil',
    addToHomeIos: 'Appuyez sur Partager, puis « Sur l\'écran d\'accueil »',
  },
  it: {
    addToHome: 'Aggiungi alla schermata Home',
    addToHomeIos: 'Tocca Condividi, poi "Aggiungi a Home"',
  },
};

interface BeforeInstallPromptEvent extends Event {
  prompt:     () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const IOS_DISMISS_KEY = 'card-add-to-home-ios-dismissed';

interface AddToHomeScreenProps {
  lang: Lang;
}

export function AddToHomeScreen({ lang }: AddToHomeScreenProps) {
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [iosDismissed, setIosDismissed] = useState(true);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari expose ce flag hors norme, absent du DOM lib standard
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);

    setIsIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
    setIosDismissed(localStorage.getItem(IOS_DISMISS_KEY) === '1');

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setDeferredPrompt(null);
  }

  function dismissIosHint() {
    localStorage.setItem(IOS_DISMISS_KEY, '1');
    setIosDismissed(true);
  }

  const t = COPY[lang];

  if (isStandalone) return null;

  if (deferredPrompt) {
    return (
      <button
        onClick={handleInstall}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-700 mt-2.5"
      >
        <IconDeviceMobilePlus size={16} stroke={1.5} />
        {t.addToHome}
      </button>
    );
  }

  if (isIos && !iosDismissed) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-gray-100 px-3 py-2.5 mt-2.5">
        <IconShare size={16} stroke={1.5} className="text-gray-400 shrink-0" />
        <span className="flex-1 text-xs text-gray-500">{t.addToHomeIos}</span>
        <button onClick={dismissIosHint} aria-label="Fermer" className="text-gray-300 shrink-0">
          <IconX size={14} stroke={1.5} />
        </button>
      </div>
    );
  }

  return null;
}
