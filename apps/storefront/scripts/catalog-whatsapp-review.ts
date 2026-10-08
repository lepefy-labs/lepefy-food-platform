/**
 * Server di revisione locale per gli artefatti del catalogo WhatsApp esterno.
 *
 *   pnpm catalog:whatsapp:review            # http://127.0.0.1:4317
 *
 * Ascolta SOLO su 127.0.0.1, serve report.html e le immagini in staging, e
 * salva le correzioni in artifacts/whatsapp-catalog/review/decisions.json.
 * Nessun accesso a Supabase né ai prodotti esistenti.
 *
 * Protezioni: Host header verificato (anti DNS-rebinding), POST solo JSON
 * same-origin (nessun header CORS → le pagine di altri siti non possono
 * scrivere), corpo max 1 MB, decisioni validate con zod e limitate ai
 * prodotti presenti, file immagine serviti solo per nome sha256.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ARTIFACT_FILES, resolveArtifactsRoot, safeArtifactPath } from '../src/lib/externalCatalog/artifacts';
import { readJsonArtifact, renderReportFromArtifacts, writeJsonArtifact } from '../src/lib/externalCatalog/localStore';
import { parseReviewDecisions } from '../src/lib/externalCatalog/reviewDecisions';
import type { NormalizedExternalProduct } from '../src/lib/externalCatalog/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { port: { type: 'string', default: '4317' }, out: { type: 'string' } },
  strict: true,
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('--port non valido.');
  process.exit(1);
}
const root = resolveArtifactsRoot(REPO_ROOT, values.out ?? null);
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const MAX_BODY = 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function send(res: ServerResponse, status: number, body: string | Uint8Array, type: string): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), 'application/json; charset=utf-8');
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
  try {
    if (!allowedHosts.has(req.headers.host ?? '')) return json(res, 421, { error: 'Host non ammesso.' });
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/report.html')) {
      const html = await renderReportFromArtifacts(root, new Date().toISOString());
      if (!html) return send(res, 404, 'Nessun report: eseguire prima pnpm catalog:whatsapp:test.', 'text/plain; charset=utf-8');
      return send(res, 200, html, 'text/html; charset=utf-8');
    }

    const img = /^\/images\/([a-f0-9]{64})\.(jpg|png|webp)$/.exec(url.pathname);
    if (req.method === 'GET' && img?.[1] && img[2]) {
      try {
        const bytes = await readFile(safeArtifactPath(root, `images/${img[1]}.${img[2]}`));
        return send(res, 200, bytes, IMAGE_TYPES[img[2]] as string);
      } catch {
        return send(res, 404, 'Not found', 'text/plain');
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/decisions') {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'JSON richiesto.' });
      const origin = req.headers.origin;
      if (origin && !allowedHosts.has(origin.replace(/^http:\/\//, ''))) return json(res, 403, { error: 'Origine non ammessa.' });
      const products = (await readJsonArtifact<NormalizedExternalProduct[]>(root, ARTIFACT_FILES.normalized)) ?? [];
      const known = new Set(products.map((p) => p.source_product_id));
      let decisions;
      try {
        decisions = parseReviewDecisions(JSON.parse(await readBody(req)), known);
      } catch (err) {
        const msg = (err as Error)?.message === 'BODY_TOO_LARGE' ? 'Corpo troppo grande.' : 'Decisioni non valide.';
        return json(res, 400, { error: msg });
      }
      await writeJsonArtifact(root, ARTIFACT_FILES.decisions, { version: 1, decisions: [...decisions.values()] });
      await renderReportFromArtifacts(root, new Date().toISOString());
      return json(res, 200, { saved: decisions.size });
    }

    return send(res, 404, 'Not found', 'text/plain');
  } catch (err) {
    console.error('[review] errore:', (err as Error)?.message);
    return json(res, 500, { error: 'Errore interno.' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[review] http://127.0.0.1:${port}  (artefatti: ${path.relative(REPO_ROOT, root)})`);
});
