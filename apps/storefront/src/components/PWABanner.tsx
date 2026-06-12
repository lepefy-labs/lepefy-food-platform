'use client';

import { useState, useEffect } from 'react';

// TODO multi-tenant: replace BG_COLOR and ACCENT_COLOR with
// tenant.secondary_color and tenant.primary_color from TenantProvider.
const BG_COLOR     = '#F2C811'; // tenant.secondary_color
const ACCENT_COLOR = '#1D9E75'; // tenant.primary_color

const DISMISS_KEY = 'pwa-banner-dismissed';
const SEVEN_DAYS  = 7 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt:     () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWABanner() {
  const [show,           setShow]           = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - parseInt(dismissed, 10) < SEVEN_DAYS) return;

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
          0%, 100% { box-shadow: 0 0 0 0   rgba(29,158,117,0.4); }
          50%       { box-shadow: 0 0 0 6px rgba(29,158,117,0);   }
        }
      `}</style>

      <div
        role="banner"
        style={{
          background:   BG_COLOR,
          borderBottom: '2px solid #d4a800',
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
          style={{
            width:        36,
            height:       36,
            borderRadius: 8,
            background:   'white',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            fontSize:     20,
            flexShrink:   0,
            animation:    'pwa-pulse 2s ease-in-out infinite',
          }}
        >
          🌿
        </div>

        {/* Text */}
        <div style={{ flex: 1 }}>
          <div style={{
            color:      '#1a1a1a',
            fontWeight: 700,
            fontSize:   13,
            lineHeight: '1.3',
          }}>
            Chloé Food
          </div>
          <div style={{
            color:      'rgba(0,0,0,0.6)',
            fontSize:   11,
            lineHeight: '1.3',
          }}>
            Installer l&apos;application
          </div>
        </div>

        {/* Actions */}
        <div style={{
          display:       'flex',
          flexDirection: 'column',
          gap:           4,
          alignItems:    'flex-end',
        }}>
          <button
            onClick={handleInstall}
            style={{
              background:   ACCENT_COLOR,
              color:        'white',
              border:       'none',
              borderRadius: 6,
              padding:      '5px 11px',
              fontSize:     11,
              fontWeight:   700,
              cursor:       'pointer',
              whiteSpace:   'nowrap',
            }}
          >
            Installer
          </button>
          <button
            onClick={handleDismiss}
            style={{
              background:     'transparent',
              color:          'rgba(0,0,0,0.5)',
              border:         'none',
              fontSize:       10,
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
