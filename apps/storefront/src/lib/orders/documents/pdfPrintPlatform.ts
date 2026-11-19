/**
 * How an order document PDF should reach the printer on this device.
 *
 * iPhone / iPad (Safari, Chrome iOS, the installed admin PWA — all WebKit)
 * print a PDF opened in a tab as a web page: the viewer's zoom is cropped on
 * both sides and the URL is printed as a header and footer (seen on A5 lists
 * printed on A4 by a tenant, 11/2026). The PDF itself is correct (A5 MediaBox).
 * Handing the FILE to the share sheet (« Imprimer ») uses the native PDF
 * print path instead: real page size, scaled to the paper, no header.
 *
 * Applies to every printable admin PDF (`PdfLink`), not only order documents.
 * Everywhere else (desktop Chrome/Edge/Safari/Firefox viewers, Android, which
 * opens the PDF in a PDF viewer) printing the PDF directly is already correct,
 * so the link keeps its plain navigation.
 */
export interface PdfPrintEnvironment {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}

export function needsSharedPdfPrint(env: PdfPrintEnvironment): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(env.userAgent)) return true;
  // iPadOS 13+ reports a desktop Mac user agent; only touch tells them apart.
  return env.platform === 'MacIntel' && (env.maxTouchPoints ?? 0) > 1;
}

/** `filename` of a Content-Disposition header, else the fallback (always ends in .pdf). */
export function pdfFilenameFromDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  let name = fallback;
  const raw = match?.[1]?.trim();
  if (raw) {
    try { name = decodeURIComponent(raw); } catch { name = raw; }
  }
  name = name.replace(/[\\/:*?"<>|]+/g, '-');
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

/** Name for a PDF served without Content-Disposition (e.g. a storage URL): last path segment, else « document ». */
export function pdfFallbackFilename(href: string): string {
  const path = href.split(/[?#]/)[0] ?? '';
  const last = path.split('/').filter(Boolean).pop() ?? '';
  let name = last;
  try { name = decodeURIComponent(last); } catch { /* keep raw */ }
  return /\.pdf$/i.test(name) ? name : 'document';
}
