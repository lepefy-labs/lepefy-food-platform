import { ORDER_DOCUMENT_FORMATS, type OrderDocumentFormat } from './formats';

/**
 * Briques HTML communes aux documents PDF (Gotenberg). Documents autonomes :
 * CSS embarqué, aucune dépendance Tailwind ni viewport admin. Toute valeur
 * dynamique passe par `escapeHtml` (ou `escapeAttr` pour un attribut).
 */
export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const escapeAttr = escapeHtml;

/** Référence courte affichée partout (jamais l'UUID complet sur un document). */
export function orderShortRef(orderId: string): string {
  return orderId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number | null {
  const match = HEX.exec(hex.trim());
  if (!match) return null;
  const raw = match[1]!.length === 3 ? match[1]!.split('').map((c) => c + c).join('') : match[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

/**
 * Couleur de marque utilisable pour du texte sur fond blanc : la couleur du
 * tenant si son contraste atteint 4,5:1 (WCAG AA), sinon un noir neutre.
 * Une couleur absente ou mal formée retombe aussi sur le neutre.
 */
export function readableBrandColor(hex: string | null | undefined, fallback = '#111111'): string {
  if (!hex) return fallback;
  const luminance = relativeLuminance(hex);
  if (luminance == null) return fallback;
  const contrast = 1.05 / (luminance + 0.05);
  return contrast >= 4.5 ? (hex.startsWith('#') ? hex : `#${hex}`) : fallback;
}

/** Couleur décorative (bandeau) : acceptée telle quelle si valide, sinon neutre. */
export function safeColor(hex: string | null | undefined, fallback = '#111111'): string {
  if (!hex || !HEX.test(hex.trim())) return fallback;
  const value = hex.trim();
  return value.startsWith('#') ? value : `#${value}`;
}

/** URL d'image acceptée dans un document : https uniquement. */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Première lettre en majuscule (français) ; le reste du texte n'est jamais modifié. */
export function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1) : text;
}

/** Pays compact : code ISO à deux lettres traduit en français (« IT » → « Italie »), toute autre valeur telle que saisie. */
export function displayCountry(value: string | null): string | null {
  if (!value) return null;
  if (!/^[A-Za-z]{2}$/.test(value)) return value;
  try {
    const name = new Intl.DisplayNames(['fr-FR'], { type: 'region' }).of(value.toUpperCase());
    return name && name.toUpperCase() !== value.toUpperCase() ? name : value.toUpperCase();
  } catch {
    return value.toUpperCase();
  }
}

/**
 * `weekday` = « Jeudi 22/10/2026 · 18:38 » : date d'en-tête des documents, le
 * jour de la semaine écrit en toutes lettres avec une majuscule (demandé par
 * les boutiques pour repérer la commande au premier coup d'œil). Seule la
 * première lettre du jour est touchée, jamais un nom, une ville ou un code.
 */
export function formatDocumentDate(iso: string, style: 'short' | 'long' | 'weekday', timeZone = 'Europe/Paris'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (style === 'weekday') {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
    }).formatToParts(date).map((part) => [part.type, part.value]));
    return `${capitalizeFirst(parts.weekday ?? '')} ${parts.day}/${parts.month}/${parts.year} · ${parts.hour}:${parts.minute}`;
  }
  return style === 'long'
    ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(date)
    : new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone }).format(date);
}

export function formatKg(weightG: number): string {
  return `${(weightG / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`;
}

/** Polices disponibles dans le conteneur Chromium de Gotenberg (repli garanti). */
export const DOCUMENT_FONT_STACK = "Arial, 'Liberation Sans', 'DejaVu Sans', Helvetica, sans-serif";

/**
 * Squelette commun. `@page size` fixe le format même si le PDF est ouvert hors
 * Gotenberg ; les marges sont envoyées à Gotenberg (pied de page numéroté).
 */
export function documentShell({ format, title, css, body }: { format: OrderDocumentFormat; title: string; css: string; body: string }): string {
  const spec = ORDER_DOCUMENT_FORMATS[format];
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
@page { size: ${spec.cssPageSize}; }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: ${DOCUMENT_FONT_STACK}; color: #111; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.doc { break-after: page; page-break-after: always; }
.doc:last-child { break-after: auto; page-break-after: auto; }
.avoid { break-inside: avoid; page-break-inside: avoid; }
.keep-next { break-after: avoid; page-break-after: avoid; }
${css}
</style>
</head>
<body class="format-${spec.id}">
${body}
</body>
</html>`;
}

/**
 * Pied de page Gotenberg (rendu par Chromium dans la marge basse). Ses retraits
 * gauche/droit suivent les marges du document (perforation comprise).
 */
export function documentFooterHtml(label: string, margins: { left: number; right: number } = { left: 9, right: 9 }): string {
  return `<!doctype html><html><head><style>
body { margin: 0; padding: 0 ${margins.right}mm 0 ${margins.left}mm; box-sizing: border-box; font-family: ${DOCUMENT_FONT_STACK}; font-size: 8pt; color: #444; display: flex; justify-content: space-between; width: 100%; -webkit-print-color-adjust: exact; }
</style></head><body><span>${escapeHtml(label)}</span><span>Page <span class="pageNumber"></span>/<span class="totalPages"></span></span></body></html>`;
}
