'use client';

import { useEffect, useRef, useState } from 'react';
import { IconCamera, IconX } from '@tabler/icons-react';
import type { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';

const SCANNER_ELEMENT_ID = 'loyalty-camera-scanner';

interface CameraScanButtonProps {
  onDecoded: (text: string) => void;
  variant?: 'default' | 'primary';
  label?: string;
}

export function CameraScanButton({
  onDecoded,
  variant = 'default',
  label = 'Scanner avec la caméra',
}: CameraScanButtonProps) {
  const [open, setOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const stateEnumRef = useRef<typeof Html5QrcodeScannerState | null>(null);
  const onDecodedRef = useRef(onDecoded);
  onDecodedRef.current = onDecoded;

  function safeStop(scanner: Html5Qrcode) {
    try {
      const states = stateEnumRef.current;
      const state = scanner.getState();
      if (states && (state === states.SCANNING || state === states.PAUSED)) {
        scanner.stop().then(() => scanner.clear()).catch((err) => {
          console.warn('Arrêt du scanner ignoré :', err);
        });
      }
    } catch (err) {
      console.warn('Arrêt du scanner ignoré :', err);
    }
  }

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    (async () => {
      const { Html5Qrcode, Html5QrcodeScannerState } = await import('html5-qrcode');
      if (cancelled) return;

      stateEnumRef.current = Html5QrcodeScannerState;
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
      scannerRef.current = scanner;

      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText: string) => {
            onDecodedRef.current(decodedText);
            safeStop(scanner);
            setOpen(false);
          },
          () => {},
        );
      } catch {
        if (!cancelled) setScanError('Impossible d\'accéder à la caméra.');
      }
    })();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      if (scanner) {
        safeStop(scanner);
        scannerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const primary = variant === 'primary';

  return (
    <>
      <button
        type="button"
        onClick={() => { setScanError(null); setOpen(true); }}
        className={primary
          ? 'w-full min-h-16 rounded-2xl px-5 py-4 text-base font-extrabold text-white shadow-sm flex items-center justify-center gap-3 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-primary)]'
          : 'w-full py-3 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 flex items-center justify-center gap-2'}
        style={primary ? { backgroundColor: 'var(--color-primary)' } : undefined}
      >
        <span className={primary ? 'flex h-10 w-10 items-center justify-center rounded-full bg-white/15' : undefined}>
          <IconCamera size={primary ? 24 : 18} stroke={1.8} />
        </span>
        {label}
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
