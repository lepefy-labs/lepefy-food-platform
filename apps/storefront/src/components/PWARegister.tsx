import Script from 'next/script';

export function PWARegister() {
  return (
    <Script id="sw-register" strategy="afterInteractive">
      {`
        (function () {
          if (!('serviceWorker' in navigator)) return;

          // The worker is intentionally network-only. Updating it replaces
          // earlier versions that could serve an obsolete cached homepage.
          navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
            .then(function (registration) {
              registration.update().catch(function (err) {
                console.warn('[PWA] Service worker update failed:', err);
              });
              document.addEventListener('visibilitychange', function () {
                if (!document.hidden) {
                  registration.update().catch(function (err) {
                    console.warn('[PWA] Service worker update failed:', err);
                  });
                }
              });
            })
            .catch(function (err) {
              console.warn('[PWA] Service worker registration failed:', err);
            });

          // A deployment can remove chunks referenced by an already-open tab.
          // Retry a failed chunk load once per tab, without clearing customer
          // storage, cookies, session, or the cart.
          var retryKey = 'lepefy:chunk-retry';
          var retryWindowMs = 5 * 60 * 1000;
          var retrying = false;
          function recoverChunkFailure(message) {
            if (retrying || !/ChunkLoadError|Loading chunk [\\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message || '')) return;
            try {
              var lastRetry = Number(sessionStorage.getItem(retryKey) || 0);
              if (Date.now() - lastRetry < retryWindowMs) return;
              sessionStorage.setItem(retryKey, String(Date.now()));
            } catch (err) {
              // Storage may be unavailable; never enter a reload loop.
              return;
            }
            retrying = true;
            var url = new URL(window.location.href);
            url.searchParams.set('_pwa_refresh', String(Date.now()));
            window.location.replace(url.toString());
          }
          window.addEventListener('error', function (event) {
            recoverChunkFailure((event.error && (event.error.name + ': ' + event.error.message)) || event.message);
          });
          window.addEventListener('unhandledrejection', function (event) {
            var reason = event.reason;
            recoverChunkFailure(typeof reason === 'string' ? reason : reason && (reason.name + ': ' + reason.message));
          });
        })();
      `}
    </Script>
  );
}
