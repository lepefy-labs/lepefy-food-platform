'use client';

import { useState, useEffect } from 'react';
import { IconShare } from '@tabler/icons-react';

type Lang = 'fr' | 'it';

const COPY: Record<Lang, {
  addToHome: (name: string) => string;
  addToHomeIos: string;
  install: string;
  later: string;
}> = {
  fr: {
    addToHome: (name) => `Ajouter ${name} à l'écran d'accueil`,
    addToHomeIos: 'Appuyez sur Partager, puis « Sur l\'écran d\'accueil »',
    install: 'Ajouter',
    later: 'Plus tard',
  },
  it: {
    addToHome: (name) => `Aggiungi ${name} alla schermata Home`,
    addToHomeIos: 'Tocca Condividi, poi "Aggiungi a Home"',
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

interface AddToHomeScreenProps {
  lang: Lang;
  tenant: {
    name: string;
    primary_color: string;
  };
}

export function AddToHomeScreen({ lang, tenant }: AddToHomeScreenProps) {
  const [show,           setShow]           = useState(false);
  const [isIos,          setIsIos]          = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Already installed as standalone app — hide
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari expose ce flag hors norme, absent du DOM lib standard
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
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

    // beforeinstallprompt only fires on Android Chrome — never on iOS or desktop
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
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
        {/* Icon — pulse sur Android (CTA d'installation directe), statique sur iOS (pas d'action, juste une consigne) */}
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
            animation:      isIos ? undefined : 'pwa-pulse 2s ease-in-out infinite',
          }}
        >
          <IconShare size={18} stroke={1.5} style={{ color: tenant.primary_color }} />
        </div>

        {/* Text */}
        <div style={{ flex: 1 }}>
          <div className="text-sm" style={{ color: '#fff', fontWeight: 700, lineHeight: '1.3' }}>
            {t.addToHome(tenant.name)}
          </div>
          {isIos && (
            <div className="text-2xs" style={{ color: 'rgba(255,255,255,0.85)', lineHeight: '1.3' }}>
              {t.addToHomeIos}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          {!isIos && (
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
