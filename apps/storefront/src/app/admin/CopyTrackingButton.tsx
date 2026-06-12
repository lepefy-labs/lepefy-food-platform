'use client';

import { useState } from 'react';

interface Props {
  orderId: string;
  email:   string;
  lang:    'fr' | 'it';
}

// Browser-safe HMAC-SHA256 using Web Crypto API.
// Mirrors the server-side generateTrackingToken but uses crypto.subtle.
async function generateTrackingTokenClient(
  orderId: string,
  email: string,
): Promise<string> {
  const secret  = process.env.NEXT_PUBLIC_TRACKING_SECRET ?? '';
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  // Input format must match the server: orderId + email (no separator)
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(orderId + email),
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function CopyTrackingButton({ orderId, email, lang }: Props) {
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');

  const tooltip = lang === 'fr' ? 'Copier le lien de suivi' : 'Copia link tracking';

  async function handleCopy() {
    if (state === 'copying') return;
    setState('copying');
    try {
      const token       = await generateTrackingTokenClient(orderId, email);
      const base        = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
      const trackingUrl = `${base}/orders/${orderId}?token=${token}`;

      await navigator.clipboard.writeText(trackingUrl);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={tooltip}
      aria-label={tooltip}
      className="inline-flex items-center justify-center w-6 h-6 rounded transition-colors"
      style={
        state === 'copied'
          ? { color: '#15803D', background: '#F0FDF4' }
          : state === 'error'
          ? { color: '#B91C1C', background: '#FEF2F2' }
          : { color: '#6B7280', background: 'transparent' }
      }
    >
      {state === 'copied' ? (
        // checkmark
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        // link / copy icon
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )}
    </button>
  );
}
