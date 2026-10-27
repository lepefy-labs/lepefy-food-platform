'use client';

import { useEffect, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import Button, { IconButton } from './ui/Button';
import InlineAlert from './ui/InlineAlert';

const DISMISS_KEY = 'lepefy-admin-install-dismissed';
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Mode = 'hidden' | 'native' | 'ios';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function recentlyDismissed() {
  try {
    const value = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Boolean(value) && Date.now() - value < DISMISS_MS;
  } catch {
    return false;
  }
}

/**
 * « Installer Lepefy Admin »: native prompt where the browser offers one
 * (Android, desktop Chrome/Edge), written instructions on iPhone/iPad, nothing
 * once installed or dismissed. Installing never changes who is signed in.
 */
export default function AdminInstallPrompt() {
  const [mode, setMode] = useState<Mode>('hidden');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;
    if (isIos()) setMode('ios');
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setMode('native');
    };
    const onInstalled = () => setMode('hidden');
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* storage unavailable: the banner may return */ }
    setMode('hidden');
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === 'accepted') setMode('hidden');
  }

  if (mode === 'hidden') return null;

  return (
    <div className="mb-4">
      <InlineAlert
        tone="info"
        title="Installer Lepefy Admin"
        action={(
          <span className="flex items-center gap-1">
            {mode === 'native' && <Button size="sm" onClick={() => void install()}>Installer</Button>}
            <IconButton label="Masquer pour 30 jours" icon={<IconX size={18} aria-hidden="true" />} onClick={dismiss} />
          </span>
        )}
      >
        {mode === 'native'
          ? 'Ouvrez l’administration depuis l’icône de votre appareil, sans passer par le navigateur.'
          : 'Touchez Partager dans Safari, puis « Sur l’écran d’accueil », pour ouvrir l’administration depuis l’icône de votre appareil.'}
      </InlineAlert>
    </div>
  );
}
