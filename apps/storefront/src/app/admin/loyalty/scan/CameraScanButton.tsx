'use client';

import { useEffect, useRef, useState } from 'react';
import { IconCamera, IconX } from '@tabler/icons-react';

const SCANNER_ELEMENT_ID = 'loyalty-camera-scanner';

interface CameraScanButtonProps {
  onDecoded: (text: string) => void;
}

// Import dynamique de html5-qrcode DANS l'effet (jamais au top-level) : la
// librairie touche `navigator`/`document` à l'import, incompatible avec le
// rendu serveur de ce composant client dans le pipeline Next.js.
export function CameraScanButton({ onDecoded }: CameraScanButtonProps) {
  const [open, setOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    (async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (cancelled) return;

      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
      scannerRef.current = scanner;

      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText: string) => {
            onDecoded(decodedText);
            void scanner.stop().then(() => scanner.clear()).catch(() => {});
            setOpen(false);
          },
          () => {
            // Callback appelé à chaque frame sans QR détecté — bruit normal,
            // volontairement ignoré (pas une erreur à afficher à l'utilisateur).
          },
        );
      } catch {
        if (!cancelled) setScanError('Impossible d\'accéder à la caméra.');
      }
    })();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      if (scanner) {
        scanner.stop().then(() => scanner.clear()).catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [open, onDecoded]);

  return (
    <>
      <button
        type="button"
        onClick={() => { setScanError(null); setOpen(true); }}
        className="w-full py-3 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 flex items-center justify-center gap-2"
      >
        <IconCamera size={18} stroke={1.8} />
        Scanner avec la caméra
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fermer"
            className="absolute top-4 right-4 text-white p-2 rounded-full bg-white/10"
          >
            <IconX size={22} />
          </button>
          <div id={SCANNER_ELEMENT_ID} className="w-full max-w-sm rounded-xl overflow-hidden" />
          {scanError && <p className="text-white text-sm mt-4">{scanError}</p>}
        </div>
      )}
    </>
  );
}
