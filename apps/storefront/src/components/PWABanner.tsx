'use client';

import { useState, useEffect } from 'react';

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
    // Already installed — hide
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    // Dismissed within 7 days — hide
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - parseInt(dismissed, 10) < SEVEN_DAYS) return;

    // Listen for Chrome's install prompt (Android only — never fires on iOS/desktop)
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
    <div
      role="banner"
      style={{
        background:     '#1D9E75',
        padding:        '10px 14px',
        display:        'flex',
        alignItems:     'center',
        gap:            10,
        // Keep above any sticky header
        position:       'relative',
        zIndex:         50,
      }}
    >
      {/* Icon */}
      <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden>🌿</span>

      {/* Text */}
      <div style={{ flex: 1 }}>
        <div style={{ color: 'white', fontWeight: 700, fontSize: 13, lineHeight: '1.3' }}>
          Chloé Food
        </div>
        <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, lineHeight: '1.3' }}>
          Installer l&apos;application
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
        <button
          onClick={handleInstall}
          style={{
            background:   'white',
            color:        '#1D9E75',
            border:       'none',
            borderRadius: 6,
            padding:      '4px 10px',
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
            color:          'rgba(255,255,255,0.75)',
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
  );
}
