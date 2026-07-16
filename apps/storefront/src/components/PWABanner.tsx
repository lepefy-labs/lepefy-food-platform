'use client';

import { useState, useEffect } from 'react';
import { useTenant } from '@/providers/TenantProvider';

const DISMISS_KEY = 'pwa-banner-dismissed';
const SEVEN_DAYS  = 7 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt:     () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWABanner() {
  const tenant = useTenant();
  const [show,           setShow]           = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Already installed as standalone app — hide
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    // Dismissed within the last 7 days — hide
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - parseInt(dismissed, 10) < SEVEN_DAYS) return;

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

  if (!show) return null;

  return (
    <>
      <style>{`
        @keyframes pwa-slide-down {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
        @keyframes pwa-pulse {
          0%, 100% { box-shadow: 0 0 0 0   color-mix(in srgb, var(--color-primary) 40%, transparent); }
          50%       { box-shadow: 0 0 0 6px transparent; }
        }
      `}</style>

      <div
        role="banner"
        style={{
          background:   'var(--color-secondary)',
          borderBottom: '2px solid color-mix(in srgb, var(--color-secondary) 80%, black)',
          padding:      '10px 14px',
          display:      'flex',
          alignItems:   'center',
          gap:          10,
          position:     'relative',
          zIndex:       50,
          animation:    'pwa-slide-down 0.4s cubic-bezier(0.4,0,0.2,1) both',
        }}
      >
        {/* Icon with pulse */}
        <div
          aria-hidden
          className="text-xl"
          style={{
            width:          36,
            height:         36,
            borderRadius:   8,
            background:     'white',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            flexShrink:     0,
            animation:      'pwa-pulse 2s ease-in-out infinite',
          }}
        >
          🌿
        </div>

        {/* Text */}
        <div style={{ flex: 1 }}>
          <div className="text-sm" style={{ color: '#1a1a1a', fontWeight: 700, lineHeight: '1.3' }}>
            {tenant.name}
          </div>
          <div className="text-2xs" style={{ color: 'rgba(0,0,0,0.6)', lineHeight: '1.3' }}>
            Installer l&apos;application
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          <button
            onClick={handleInstall}
            className="text-2xs"
            style={{
              background:   'var(--color-primary)',
              color:        'white',
              border:       'none',
              borderRadius: 6,
              padding:      '5px 11px',
              fontWeight:   700,
              cursor:       'pointer',
              whiteSpace:   'nowrap',
            }}
          >
            Installer
          </button>
          <button
            onClick={handleDismiss}
            className="text-2xs"
            style={{
              background:     'transparent',
              color:          'rgba(0,0,0,0.5)',
              border:         'none',
              textDecoration: 'underline',
              cursor:         'pointer',
              padding:        0,
            }}
          >
            Plus tard
          </button>
        </div>
      </div>
    </>
  );
}
