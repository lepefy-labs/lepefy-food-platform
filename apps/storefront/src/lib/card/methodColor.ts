import type { TenantPaymentMethod } from '@lepefy/types';

// Colori brand a livello di piattaforma (non tenant-specific): PayPal blu
// ufficiale, contanti verde, Satispay coral, virement/altro nel colore
// primario del tenant. Condiviso tra PosterTemplate e DigitalCard.
export function methodColor(method: TenantPaymentMethod['method'], tenantPrimary: string): string {
  switch (method) {
    case 'paypal':   return '#003087';
    case 'cash':     return '#2E7D32';
    case 'satispay': return '#FF3B30';
    default:         return tenantPrimary; // bank_transfer, other
  }
}

// Converte un colore hex in rgba con opacità data, per sfondi tinti leggeri
// dietro i badge dei metodi di pagamento.
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Maschera un valore sensibile (es. IBAN) mantenendo visibili solo le prime
// e le ultime 4 cifre — usato solo per bank_transfer, mai per link pubblici
// come PayPal/Satispay che restano cliccabili in chiaro.
export function maskSensitiveValue(value: string): string {
  const clean = value.replace(/\s+/g, '');
  if (clean.length <= 8) return value;
  return `${clean.slice(0, 4)} •••• •••• ${clean.slice(-4)}`;
}
