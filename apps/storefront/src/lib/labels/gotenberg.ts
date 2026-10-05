/**
 * Client Gotenberg unique (Chromium HTML → PDF).
 *
 * Sans `options`, la requête est strictement identique à l'historique
 * (étiquettes, affiche, billets, listes Événementiel) : seul `index.html`.
 * Les options ajoutent les champs de formulaire Chromium standard (papier en
 * pouces, marges, fond, pied de page `footer.html` avec `pageNumber` /
 * `totalPages`) et un délai maximal.
 */
export interface HtmlToPdfOptions {
  paperWidthMm?: number;
  paperHeightMm?: number;
  marginsMm?: { top: number; right: number; bottom: number; left: number };
  printBackground?: boolean;
  footerHtml?: string;
  /** Délai maximal de la requête (ms). */
  timeoutMs?: number;
}

/** Gotenberg absent, injoignable ou trop lent : la route répond 503. */
export class GotenbergUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GotenbergUnavailableError';
  }
}

/** Gotenberg a répondu une erreur : la route répond 502. */
export class GotenbergConversionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'GotenbergConversionError';
  }
}

const mmToInches = (mm: number) => (mm / 25.4).toFixed(3);

/** Pur : champs de formulaire ajoutés par les options (testé unitairement). */
export function gotenbergOptionFields(options: HtmlToPdfOptions): Array<[string, string]> {
  const fields: Array<[string, string]> = [];
  if (options.paperWidthMm) fields.push(['paperWidth', mmToInches(options.paperWidthMm)]);
  if (options.paperHeightMm) fields.push(['paperHeight', mmToInches(options.paperHeightMm)]);
  if (options.marginsMm) {
    fields.push(['marginTop', mmToInches(options.marginsMm.top)]);
    fields.push(['marginRight', mmToInches(options.marginsMm.right)]);
    fields.push(['marginBottom', mmToInches(options.marginsMm.bottom)]);
    fields.push(['marginLeft', mmToInches(options.marginsMm.left)]);
  }
  if (options.printBackground !== undefined) fields.push(['printBackground', String(options.printBackground)]);
  return fields;
}

export async function htmlToPdf(html: string, options?: HtmlToPdfOptions): Promise<Buffer> {
  const url = process.env.GOTENBERG_URL;
  if (!url) {
    if (options) throw new GotenbergUnavailableError('GOTENBERG_URL non configurata');
    throw new Error('GOTENBERG_URL non configurata');
  }

  const formData = new FormData();
  formData.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  if (options) {
    if (options.footerHtml) formData.append('files', new Blob([options.footerHtml], { type: 'text/html' }), 'footer.html');
    for (const [name, value] of gotenbergOptionFields(options)) formData.append(name, value);
  }

  const headers: Record<string, string> = {};
  if (process.env.GOTENBERG_AUTH) {
    headers['Authorization'] = `Basic ${Buffer.from(process.env.GOTENBERG_AUTH).toString('base64')}`;
  }

  let res: Response;
  try {
    res = await fetch(`${url}/forms/chromium/convert/html`, {
      method: 'POST',
      headers,
      body: formData,
      ...(options?.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
    });
  } catch (error) {
    if (options) throw new GotenbergUnavailableError(error instanceof Error ? error.message : 'Gotenberg injoignable');
    throw error;
  }

  if (!res.ok) {
    const text = await res.text();
    if (options) {
      if (res.status === 503 || res.status === 504) throw new GotenbergUnavailableError(`Gotenberg ${res.status}`);
      throw new GotenbergConversionError(res.status, `Gotenberg error ${res.status}: ${text.slice(0, 300)}`);
    }
    throw new Error(`Gotenberg error ${res.status}: ${text}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
