import Script from 'next/script';

export function PWARegister() {
  return (
    <Script id="sw-register" strategy="afterInteractive">
      {`
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.register('/sw.js').catch(function(err) {
            console.warn('[PWA] Service worker registration failed:', err);
          });
        }
      `}
    </Script>
  );
}
