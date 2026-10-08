import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { StagedImageInfo } from './types';

/**
 * Download in staging LOCALE delle immagini di un catalogo esterno.
 * Mai verso lo storage del tenant: la copia definitiva richiede un'autorizzazione
 * esplicita sui diritti d'uso (ciclo futuro).
 *
 * Protezioni SSRF:
 *   - solo https, porta 443, nessuna credenziale nell'URL, nessun IP letterale;
 *   - host in allow-list (CDN Meta/WhatsApp per default);
 *   - tutti gli indirizzi DNS risolti devono essere pubblici;
 *   - redirect gestiti manualmente (max 3), ogni salto è rivalidato;
 *   - dimensione massima, tipo verificato sui magic bytes (non sull'header).
 * Rischio residuo: DNS rebinding tra la verifica e la connessione di `fetch`;
 * mitigato dall'allow-list di domini Meta (documentato).
 */

export const DEFAULT_IMAGE_HOST_SUFFIXES = ['fbcdn.net', 'whatsapp.net', 'cdninstagram.com', 'facebook.com'];
const MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const MIN_DIMENSION = 100;
const MAX_DIMENSION = 12_000;
export const LOW_RESOLUTION_THRESHOLD = 600;

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageStagingDeps {
  fetch?: typeof fetch;
  lookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  probe?: (bytes: Uint8Array) => Promise<{ width: number; height: number } | null>;
  writeFile?: (relativeFile: string, bytes: Uint8Array) => Promise<void>;
  now?: () => Date;
}

export interface ImageStagingOptions {
  allowedHostSuffixes?: string[];
  maxBytes?: number;
  timeoutMs?: number;
  /** Non scrive file (dry-run): verifica soltanto. */
  dryRun?: boolean;
}

export class UnsafeImageUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeImageUrlError';
  }
}

// ─── Indirizzi ───────────────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4Range(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !PRIVATE_V4.some(([base, bits]) => inV4Range(address, base, bits));
  if (family === 6) {
    const a = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped?.[1]) return isPublicIp(mapped[1]);
    if (a === '::' || a === '::1') return false;
    if (/^f[cd]/.test(a)) return false;            // fc00::/7 ULA
    if (/^fe[89ab]/.test(a)) return false;         // fe80::/10 link-local
    if (/^ff/.test(a)) return false;               // multicast
    if (a.startsWith('2001:db8') || a.startsWith('64:ff9b') || a.startsWith('2002:')) return false;
    return true;
  }
  return false;
}

export function assertAllowedImageUrl(raw: string, allowedHostSuffixes = DEFAULT_IMAGE_HOST_SUFFIXES): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeImageUrlError('URL immagine non valido.');
  }
  if (url.protocol !== 'https:') throw new UnsafeImageUrlError('Solo URL https.');
  if (url.username || url.password) throw new UnsafeImageUrlError('Credenziali nell\'URL non ammesse.');
  if (url.port && url.port !== '443') throw new UnsafeImageUrlError('Porta non ammessa.');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isIP(host.replace(/^\[|\]$/g, ''))) throw new UnsafeImageUrlError('IP letterale non ammesso.');
  if (!allowedHostSuffixes.some((s) => host === s || host.endsWith(`.${s}`))) {
    throw new UnsafeImageUrlError(`Host non in allow-list: ${host}.`);
  }
  return url;
}

// ─── Contenuto ───────────────────────────────────────────────────────────────

export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  return null;
}

const EXT: Record<ImageMime, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function sharpProbe(bytes: Uint8Array): Promise<{ width: number; height: number } | null> {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(bytes).metadata();
    return meta.width && meta.height ? { width: meta.width, height: meta.height } : null;
  } catch {
    return null;
  }
}

async function defaultLookup(hostname: string) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

// ─── Downloader ──────────────────────────────────────────────────────────────

export interface ImageStager {
  stage(url: string): Promise<StagedImageInfo>;
  /** sha256 → file già scritto (deduplica fra prodotti e fra esecuzioni). */
  readonly knownHashes: Map<string, string>;
}

export function createImageStager(deps: ImageStagingDeps = {}, options: ImageStagingOptions = {}, initialHashes?: Map<string, string>): ImageStager {
  const doFetch = deps.fetch ?? fetch;
  const lookup = deps.lookup ?? defaultLookup;
  const probe = deps.probe ?? sharpProbe;
  const now = deps.now ?? (() => new Date());
  const allowed = options.allowedHostSuffixes ?? DEFAULT_IMAGE_HOST_SUFFIXES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const knownHashes = initialHashes ?? new Map<string, string>();
  const byUrl = new Map<string, StagedImageInfo>();

  function result(status: StagedImageInfo['status'], detail: string | null, extra: Partial<StagedImageInfo> = {}): StagedImageInfo {
    return { status, sha256: null, file: null, mime: null, bytes: null, width: null, height: null, detail, fetched_at: now().toISOString(), ...extra };
  }

  async function assertPublicHost(url: URL): Promise<void> {
    const addresses = await lookup(url.hostname);
    if (addresses.length === 0) throw new UnsafeImageUrlError('Host senza indirizzi DNS.');
    for (const a of addresses) {
      if (!isPublicIp(a.address)) throw new UnsafeImageUrlError(`Host risolto verso un indirizzo non pubblico (${a.address}).`);
    }
  }

  async function stage(rawUrl: string): Promise<StagedImageInfo> {
    const cached = byUrl.get(rawUrl);
    if (cached) return { ...cached, status: cached.status === 'downloaded' ? 'duplicate' : cached.status };

    let current: URL;
    try {
      current = assertAllowedImageUrl(rawUrl, allowed);
    } catch (err) {
      return result('rejected', (err as Error).message);
    }

    let res: Response | null = null;
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await assertPublicHost(current);
        res = await doFetch(current.toString(), { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) return result('error', `Redirect ${res.status} senza Location.`);
          if (hop === MAX_REDIRECTS) return result('rejected', 'Troppi redirect.');
          current = assertAllowedImageUrl(new URL(location, current).toString(), allowed);
          continue;
        }
        break;
      }
    } catch (err) {
      if (err instanceof UnsafeImageUrlError) return result('rejected', err.message);
      const name = (err as { name?: string })?.name;
      return result('error', name === 'TimeoutError' ? 'Timeout del download.' : 'Errore di rete durante il download.');
    }
    if (!res) return result('error', 'Nessuna risposta.');

    if (res.status === 403 || res.status === 404 || res.status === 410) {
      // Gli URL CDN Meta sono firmati e scadono: va ri-letto il catalogo.
      const r = result('expired', `HTTP ${res.status}: URL scaduto o non più disponibile.`);
      byUrl.set(rawUrl, r);
      return r;
    }
    if (!res.ok) return result('error', `HTTP ${res.status}.`);

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return result('rejected', `Immagine troppo grande (${declared} byte).`);

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch {
      return result('error', 'Lettura del contenuto fallita.');
    }
    if (bytes.length === 0) return result('rejected', 'Contenuto vuoto.');
    if (bytes.length > maxBytes) return result('rejected', `Immagine troppo grande (${bytes.length} byte).`);

    const mime = sniffImageMime(bytes);
    if (!mime) return result('rejected', `Formato non ammesso (content-type dichiarato: ${res.headers.get('content-type') ?? 'assente'}).`);

    const dims = await probe(bytes);
    if (!dims) return result('rejected', 'Dimensioni non leggibili: immagine corrotta o non supportata.', { mime, bytes: bytes.length });
    if (dims.width < MIN_DIMENSION || dims.height < MIN_DIMENSION || dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION) {
      return result('rejected', `Dimensioni fuori limite (${dims.width}×${dims.height}).`, { mime, bytes: bytes.length, ...dims });
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = knownHashes.get(sha256);
    const base = { sha256, mime, bytes: bytes.length, width: dims.width, height: dims.height };
    if (existing) {
      const r = result('duplicate', 'Stesso contenuto già in staging.', { ...base, file: existing });
      byUrl.set(rawUrl, r);
      return r;
    }

    const file = `images/${sha256}.${EXT[mime]}`;
    if (!options.dryRun && deps.writeFile) await deps.writeFile(file, bytes);
    knownHashes.set(sha256, file);
    const lowRes = dims.width < LOW_RESOLUTION_THRESHOLD || dims.height < LOW_RESOLUTION_THRESHOLD;
    const r = result('downloaded', lowRes ? `Risoluzione bassa (${dims.width}×${dims.height}).` : null, {
      ...base,
      file: options.dryRun ? null : file,
    });
    byUrl.set(rawUrl, r);
    return r;
  }

  return { stage, knownHashes };
}
