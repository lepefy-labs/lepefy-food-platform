'use client';

import { useState, useEffect } from 'react';
import { IconShare } from '@tabler/icons-react';

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
      setShow(true);
      return;
    }

    let promptReceived = false;

    // beforeinstallprompt only fires on Android Chrome — never on iOS or desktop
    const handler = (e: Event) => {
      promptReceived = true;
      // DEBUG TEMPORAIRE
      console.log('[a2hs] beforeinstallprompt fired: true');
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
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
        setShow(true);
      }
    }, PROMPT_TIMEOUT_MS);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.clearTimeout(fallbackTimer);
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
        @keyframes pwa-slide-down {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
        @keyframes pwa-pulse {
          0%, 100% { box-shadow: 0 0 0 0   color-mix(in srgb, ${tenant.primary_color} 40%, transparent); }
          50%       { box-shadow: 0 0 0 6px transparent; }
        }
      `}</style>

      <div
        role="banner"
        style={{
          background:   tenant.primary_color,
          borderBottom: `2px solid color-mix(in srgb, ${tenant.primary_color} 80%, black)`,
          padding:      '10px 14px',
          display:      'flex',
          alignItems:   'center',
          gap:          10,
          position:     'relative',
          zIndex:       50,
          animation:    'pwa-slide-down 0.4s cubic-bezier(0.4,0,0.2,1) both',
        }}
      >
        {/* Icon — pulse quand une action directe est possible (deferredPrompt), statique sinon (iOS ou fallback manuel) */}
        <div
          aria-hidden
          style={{
            width:          36,
            height:         36,
            borderRadius:   8,
            background:     'white',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            flexShrink:     0,
            animation:      deferredPrompt ? 'pwa-pulse 2s ease-in-out infinite' : undefined,
          }}
        >
          <IconShare size={18} stroke={1.5} style={{ color: tenant.primary_color }} />
        </div>

        {/* Text */}
        <div style={{ flex: 1 }}>
          <div className="text-sm" style={{ color: '#fff', fontWeight: 700, lineHeight: '1.3' }}>
            {t.addToHome(tenant.name)}
          </div>
          {showSubtext && (
            <div className="text-2xs" style={{ color: 'rgba(255,255,255,0.85)', lineHeight: '1.3' }}>
              {isIos ? t.addToHomeIos : t.addToHomeAndroidFallback}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          {deferredPrompt && (
            <button
              onClick={handleInstall}
              className="text-2xs"
              style={{
                background:   'white',
                color:        tenant.primary_color,
                border:       'none',
                borderRadius: 6,
                padding:      '5px 11px',
                fontWeight:   700,
                cursor:       'pointer',
                whiteSpace:   'nowrap',
              }}
            >
              {t.install}
            </button>
          )}
          <button
            onClick={handleDismiss}
            className="text-2xs"
            style={{
              background:     'transparent',
              color:          'rgba(255,255,255,0.75)',
              border:         'none',
              textDecoration: 'underline',
              cursor:         'pointer',
              padding:        0,
            }}
          >
            {t.later}
          </button>
        </div>
      </div>
    </>
  );
}
