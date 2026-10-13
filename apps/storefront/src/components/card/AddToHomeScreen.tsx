'use client';

import { useState, useEffect } from 'react';
import { IconShare, IconX } from '@tabler/icons-react';

type Lang = 'fr' | 'it';

const COPY: Record<Lang, {
  addToHome: (name: string) => string;
  addToHomeIos: string;
  addToHomeAndroidFallback: string;
  install: string;
  later: string;
}> = {
  fr: {
    addToHome: (name) => `Ajouter ${name} à l'écran d'accueil`,
    addToHomeIos: 'Appuyez sur Partager, puis « Sur l\'écran d\'accueil »',
    addToHomeAndroidFallback: 'Ouvrez le menu ⋮ de votre navigateur, puis « Ajouter à l\'écran d\'accueil »',
    install: 'Ajouter',
    later: 'Plus tard',
  },
  it: {
    addToHome: (name) => `Aggiungi ${name} alla schermata Home`,
    addToHomeIos: 'Tocca Condividi, poi "Aggiungi a Home"',
    addToHomeAndroidFallback: 'Apri il menu ⋮ del browser, poi "Aggiungi a schermata Home"',
    install: 'Aggiungi',
    later: 'Più tardi',
  },
};

interface BeforeInstallPromptEvent extends Event {
  prompt:     () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Clé distincte de PWABanner (pwa-banner-dismissed) : contexte différent
// (card vs boutique), ne doit pas partager son état de dismiss.
const DISMISS_KEY = 'card-a2hs-dismissed';
const SEVEN_DAYS  = 7 * 24 * 60 * 60 * 1000;

// Délai d'attente du vrai `beforeinstallprompt` avant de basculer sur le
// chemin manuel — l'événement, quand il arrive, arrive quasi toujours
// immédiatement au montage. Voir note de debug dans le résumé de session :
// ce timeout ne "corrige" rien côté plateforme, il garantit juste qu'il
// reste toujours une option visible pour l'utilisateur.
const PROMPT_TIMEOUT_MS = 2500;

// /card est d'abord une page de paiement : le bandeau n'apparaît qu'après ce
// délai, en surimpression (jamais dans le flux, donc aucun décalage de la
// hero ni des boutons « Payer maintenant » / « Commander »).
const BANNER_DELAY_MS = 8000;

interface AddToHomeScreenProps {
  lang: Lang;
  tenant: {
    name: string;
    primary_color: string;
  };
}

export function AddToHomeScreen({ lang, tenant }: AddToHomeScreenProps) {
  const [show,               setShow]               = useState(false);
  const [isIos,               setIsIos]              = useState(false);
  const [showManualFallback,  setShowManualFallback] = useState(false);
  const [deferredPrompt,      setDeferredPrompt]     = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Already installed as standalone app — hide.
    // `display-mode: standalone` est scoped au contexte de navigation
    // courant (ce document précis), pas un état global "une PWA de cet
    // origin est installée quelque part sur l'appareil" — donc ne doit PAS
    // renvoyer true juste parce que la PWA du magasin est déjà installée
    // ailleurs. Vérifié par lecture de la spec, pas par un test live.
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari expose ce flag hors norme, absent du DOM lib standard
      (navigator as Navigator & { standalone?: boolean }).standalone === true;

    // DEBUG TEMPORAIRE — à retirer une fois l'hypothèse A/B/C confirmée en
    // conditions réelles (voir résumé de session).
    console.log('[a2hs] standalone check:', standalone);

    if (standalone) return;

    // Dismissed within the last 7 days — hide
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - parseInt(dismissed, 10) < SEVEN_DAYS) return;

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIos(ios);

    // iOS n'a pas d'API beforeinstallprompt : on affiche directement le
    // bandeau instructif, sans attendre un événement qui ne viendra jamais.
    if (ios) {
      const iosTimer = window.setTimeout(() => setShow(true), BANNER_DELAY_MS);
      return () => window.clearTimeout(iosTimer);
    }

    let promptReceived = false;

    // beforeinstallprompt only fires on Android Chrome — never on iOS or desktop
    const handler = (e: Event) => {
      promptReceived = true;
      // DEBUG TEMPORAIRE
      console.log('[a2hs] beforeinstallprompt fired: true');
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Fallback : si l'événement natif n'arrive pas dans un délai
    // raisonnable, on affiche un chemin manuel plutôt que de ne rien
    // montrer. Cas connu (non résolu ici, limite de plateforme probable) :
    // Chrome/Android peut supprimer la promotion d'installation automatique
    // pour un second scope du même origin quand une autre PWA du même site
    // est déjà installée.
    const fallbackTimer = window.setTimeout(() => {
      if (!promptReceived) {
        // DEBUG TEMPORAIRE
        console.log('[a2hs] beforeinstallprompt fired: false (timeout, fallback manuel affiché)');
        setShowManualFallback(true);
      }
    }, PROMPT_TIMEOUT_MS);
    const showTimer = window.setTimeout(() => setShow(true), BANNER_DELAY_MS);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(showTimer);
    };
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setShow(false);
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
    setShow(false);
  }

  const t = COPY[lang];
  const showSubtext = isIos || showManualFallback;

  if (!show) return null;

  return (
    <>
      <style>{`
        @keyframes card-a2hs-in {
          from { transform: translateY(-120%); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-pwa-banner] { animation: none !important; }
        }
      `}</style>

      <div
        role="dialog"
        aria-label={t.addToHome(tenant.name)}
        data-pwa-banner
        className="fixed inset-x-2 top-[max(.5rem,env(safe-area-inset-top))] z-[60] mx-auto flex max-w-md items-center gap-2.5 rounded-2xl bg-white py-2 pl-3 pr-1 shadow-[0_10px_30px_rgba(17,24,39,0.22)] ring-1 ring-black/5"
        style={{ animation: 'card-a2hs-in 0.35s cubic-bezier(0.4,0,0.2,1) both' }}
      >
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: tenant.primary_color }}>
          <IconShare size={18} stroke={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold leading-tight text-gray-900">{t.addToHome(tenant.name)}</span>
          {showSubtext && <span className="mt-0.5 block text-xs leading-snug text-gray-700">{isIos ? t.addToHomeIos : t.addToHomeAndroidFallback}</span>}
        </span>
        {deferredPrompt && (
          <button
            type="button"
            onClick={handleInstall}
            className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{ backgroundColor: tenant.primary_color, '--tw-ring-color': tenant.primary_color } as React.CSSProperties}
          >
            {t.install}
          </button>
        )}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t.later}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
        >
          <IconX size={20} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
