'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useCartStore } from '@/stores/cartStore';
import { flushCart } from '@/lib/cart/cartSyncEngine';
import { isBusy, subscribeBusyRelease } from '@/lib/pwa/busyRegistry';
import {
  hasEditableForm,
  hasTouchedFields,
  installActivityTracker,
  resetTouchedFields,
} from '@/lib/pwa/activityTracker';
import {
  CHUNK_ERROR_PATTERN,
  createLifecycleController,
  type LifecycleController,
} from '@/lib/pwa/lifecycle';
import { BUNDLE_VERSION, fetchRemoteVersion } from '@/lib/pwa/versionCheck';

function safeSessionStorage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

// Registers the (network-only) service worker and drives the smart refresh
// (docs/PWA_LIFECYCLE.md). Mounted once in the root layout, for the storefront
// and for Lepefy Admin; the policy is chosen by scope in lib/pwa/lifecycle.ts.
export function PwaLifecycle() {
  const router = useRouter();
  const pathname = usePathname();
  const routerRef = useRef(router);
  routerRef.current = router;
  const controllerRef = useRef<LifecycleController | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Fields typed into on the previous page no longer protect anything.
  useEffect(() => { resetTouchedFields(); }, [pathname]);

  useEffect(() => {
    const removeTracker = installActivityTracker();

    const controller = createLifecycleController({
      now: () => Date.now(),
      currentVersion: BUNDLE_VERSION,
      storage: safeSessionStorage(),
      isOnline: () => navigator.onLine !== false,
      pathname: () => window.location.pathname,
      isBusy: () => isBusy() || hasTouchedFields(),
      hasEditableForm,
      hasPendingCartMutations: () => useCartStore.getState().pendingMutations.length > 0,
      fetchRemoteVersion,
      updateServiceWorker: async () => {
        try { await registrationRef.current?.update(); } catch { /* network-only worker: best effort */ }
      },
      refreshData: () => routerRef.current.refresh(),
      revalidateSession: async () => {
        // Only a definite answer changes anything: a network error leaves the session untouched.
        try {
          const res = await fetch('/api/auth/session', { cache: 'no-store' });
          if (!res.ok) return;
          const data = await res.json() as { customer?: unknown };
          if (data.customer) window.dispatchEvent(new Event('lepefy:customer-authenticated'));
          else if (useCartStore.getState().ownerCustomerId) window.dispatchEvent(new Event('lepefy:customer-logged-out'));
        } catch { /* ignore */ }
      },
      flushCart: async () => { try { await flushCart({ keepalive: true }); } catch { /* best effort */ } },
      reload: () => window.location.reload(),
      schedule: (fn, ms) => { const id = window.setTimeout(fn, ms); return () => window.clearTimeout(id); },
      onUpdateAvailable: (available) => { setUpdateAvailable(available); if (available) setDismissed(false); },
    });
    controllerRef.current = controller;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
        .then((registration) => { registrationRef.current = registration; })
        .catch((err) => console.warn('[PWA] Service worker registration failed:', err));
    }
    void controller.onResume('start');

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') controller.onHidden();
      else void controller.onResume('visible');
    };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void controller.onResume('pageshow'); };
    const onPageHide = () => controller.onHidden();
    // `focus` is only a fallback for desktop browsers; the controller de-duplicates.
    const onFocus = () => { if (document.visibilityState === 'visible') void controller.onResume('focus'); };
    const onOnline = () => void controller.onResume('online');
    const onChunk = (message: string | undefined) => {
      if (message && CHUNK_ERROR_PATTERN.test(message)) controller.onChunkError();
    };
    const onError = (event: ErrorEvent) =>
      onChunk(event.error ? `${event.error.name}: ${event.error.message}` : event.message);
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      onChunk(typeof reason === 'string' ? reason : reason ? `${reason.name}: ${reason.message}` : undefined);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    const unsubscribe = subscribeBusyRelease(() => controller.onLockReleased());

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      unsubscribe();
      removeTracker();
      controllerRef.current = null;
    };
  }, []);

  if (!updateAvailable || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 'calc(5rem + env(safe-area-inset-bottom))',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        maxWidth: 420,
        margin: '0 auto',
        padding: '10px 12px 10px 14px',
        borderRadius: 12,
        background: '#1f2937',
        color: '#ffffff',
        fontSize: 14,
        boxShadow: '0 4px 16px rgba(0,0,0,.25)',
      }}
    >
      <span style={{ flex: 1 }}>Une nouvelle version est disponible.</span>
      <button
        type="button"
        onClick={() => void controllerRef.current?.applyNow()}
        style={{ background: '#ffffff', color: '#111827', border: 0, borderRadius: 8, padding: '8px 12px', fontWeight: 600, fontSize: 14, minHeight: 36 }}
      >
        Mettre à jour
      </button>
      <button
        type="button"
        aria-label="Plus tard"
        onClick={() => setDismissed(true)}
        style={{ background: 'transparent', color: '#d1d5db', border: 0, fontSize: 18, lineHeight: 1, padding: '6px 8px', minHeight: 36 }}
      >
        ×
      </button>
    </div>
  );
}
