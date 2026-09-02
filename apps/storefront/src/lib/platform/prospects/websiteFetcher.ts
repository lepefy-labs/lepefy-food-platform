import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { CONFIG } from './config';
export class CrawlError extends Error {
  constructor(public code: string, public status: number | null = null, public retrySeconds = 0) { super(code); }
}
export function normalizeUrl(input: string): URL {
  const url = new URL(input.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || (url.port && !['80','443'].includes(url.port))) throw new CrawlError('url_refused');
  url.hash = '';
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || (!host.includes('.') && !host.includes(':')) || /\.(localhost|local|internal|lan|home|test|invalid)$/.test(host)) {
    throw new CrawlError('host_refused');
  }
  url.hostname = host;
  if (url.href.length > 2048) throw new CrawlError('url_too_long');
  return url;
}
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const parts = address.split(':');
    const first = parseInt(parts[0],16), second = parseInt(parts[1] || '0',16);
    // Strict global-unicast allowlist, excluding special-use and transition networks.
    return first >= 0x2000 && first <= 0x3fff
      && !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8))
      && first !== 0x2002 && first !== 0x3fff;
  }
  return false;
}
export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
export async function resolvePublic(host: string, resolver: Resolver = h => lookup(h, { all:true, verbatim:true })) {
  const clean = host.replace(/^\[|\]$/g, '');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      isIP(clean) ? Promise.resolve([{ address:clean, family:isIP(clean) }]) : resolver(clean),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CrawlError('dns_timeout')), CONFIG.requestTimeoutMs); }),
    ]);
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new CrawlError('private_address');
    return addresses[0];
  } finally { clearTimeout(timer); }
}
export type HttpPage = { url:string; status:number; body:string; contentType:string };
export type RequestOptions = {
  contentTypes?: string[]; maxBytes?: number; redirects?: number; sameOrigin?: string; deadline?: number;
  beforeRequest?: (url: URL) => Promise<void>;
};
export async function safeGet(input: string, options: RequestOptions = {}): Promise<HttpPage> {
  let url = normalizeUrl(input);
  for (let hop = 0; hop <= (options.redirects ?? CONFIG.maxRedirects); hop++) {
    if (options.deadline && Date.now()+10000 > options.deadline) throw new CrawlError('crawl_budget');
    if (options.sameOrigin && url.origin !== options.sameOrigin) throw new CrawlError('external_redirect');
    await options.beforeRequest?.(url);
    if (options.deadline && Date.now()+5000 > options.deadline) throw new CrawlError('crawl_budget');
    const resolved = await resolvePublic(url.hostname);
    const response = await new Promise<{ status:number; headers:http.IncomingHttpHeaders; body:string }>((resolve,reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      // Connect to the validated address: no second DNS lookup / DNS rebinding window.
      const req = transport.request(url, {
        method:'GET', agent:false, family:resolved.family,
        headers:{ 'User-Agent':CONFIG.userAgent, Accept:(options.contentTypes ?? ['text/html','application/xhtml+xml']).join(', '),
          'Accept-Encoding':'identity' },
        lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family),
      }, res => {
        const status = res.statusCode ?? 0;
        if (status !== 200) { res.resume(); resolve({ status, headers:res.headers, body:'' }); return; }
        const type = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        if (!(options.contentTypes ?? ['text/html','application/xhtml+xml']).includes(type)) {
          res.destroy(); reject(new CrawlError('unsupported_content', status)); return;
        }
        if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
          res.destroy(); reject(new CrawlError('encoded_content', status)); return;
        }
        const max = options.maxBytes ?? CONFIG.maxBytes;
        if (Number(res.headers['content-length'] ?? 0) > max) { res.destroy(); reject(new CrawlError('response_too_large',status)); return; }
        const chunks: Buffer[] = []; let bytes = 0;
        res.on('data', (chunk:Buffer) => {
          bytes += chunk.length;
          if (bytes > max) { res.destroy(new CrawlError('response_too_large',status)); return; }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status, headers:res.headers, body:Buffer.concat(chunks).toString('utf8') }));
        res.on('error',reject);
        res.on('aborted', () => reject(new CrawlError('response_aborted',status)));
      });
      const timer = setTimeout(() => req.destroy(new CrawlError('timeout')), Math.max(1,Math.min(CONFIG.requestTimeoutMs,(options.deadline ?? Infinity)-Date.now())));
      req.on('error',reject); req.on('close', () => clearTimeout(timer)); req.end();
    });
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      url = normalizeUrl(new URL(response.headers.location, url).href); continue;
    }
    if (response.status === 429 || response.status === 503) {
      const raw = response.headers['retry-after'];
      const wait = raw && /^\d+$/.test(raw) ? Number(raw) : raw ? Math.ceil((Date.parse(raw)-Date.now())/1000) : 60;
      throw new CrawlError('upstream_backoff',response.status, Math.max(60, Math.min(86400, Number.isFinite(wait) ? wait : 60)));
    }
    if (response.status !== 200) throw new CrawlError([401,403].includes(response.status) ? 'access_blocked' : 'http_error', response.status);
    return { url:url.href, status:response.status, body:response.body, contentType:String(response.headers['content-type']) };
  }
  throw new CrawlError('redirect_limit');
}
