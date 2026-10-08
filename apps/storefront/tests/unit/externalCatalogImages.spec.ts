import { test, expect } from '@playwright/test';
import { assertAllowedImageUrl, createImageStager, isPublicIp, sniffImageMime } from '../../src/lib/externalCatalog/imageStaging';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const JPEG_B = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);
const HTML = new TextEncoder().encode('<html>not an image</html>');

const publicDns = async () => [{ address: '157.240.1.1', family: 4 }];
const probe = async () => ({ width: 800, height: 800 });

function fetchFrom(map: Record<string, { status: number; body?: Uint8Array; headers?: Record<string, string> }>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const r = map[url];
    if (!r) return new Response('not found', { status: 404 });
    return new Response(r.body ? (r.body as unknown as BodyInit) : null, { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return { fn, calls };
}

test.describe('SSRF', () => {
  test('URL rifiutati prima di qualsiasi richiesta', () => {
    for (const bad of [
      'http://scontent.xx.fbcdn.net/a.jpg',
      'https://127.0.0.1/a.jpg',
      'https://[::1]/a.jpg',
      'https://user:pw@scontent.xx.fbcdn.net/a.jpg',
      'https://scontent.xx.fbcdn.net:8443/a.jpg',
      'https://evil.example/a.jpg',
      'https://fbcdn.net.evil.example/a.jpg',
      'file:///etc/passwd',
    ]) {
      expect(() => assertAllowedImageUrl(bad), bad).toThrow();
    }
    expect(assertAllowedImageUrl('https://scontent.xx.fbcdn.net/a.jpg').hostname).toBe('scontent.xx.fbcdn.net');
  });

  test('indirizzi privati/riservati', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
    expect(isPublicIp('157.240.1.1')).toBe(true);
    expect(isPublicIp('2a03:2880:f12f:83:face:b00c:0:25de')).toBe(true);
  });

  test('host in allow-list risolto verso IP privato → rifiutato', async () => {
    const f = fetchFrom({});
    const stager = createImageStager({ fetch: f.fn, lookup: async () => [{ address: '169.254.169.254', family: 4 }], probe });
    const r = await stager.stage('https://scontent.xx.fbcdn.net/a.jpg');
    expect(r.status).toBe('rejected');
    expect(f.calls).toEqual([]);
  });

  test('redirect verso destinazione non consentita → rifiutato', async () => {
    const f = fetchFrom({ 'https://scontent.xx.fbcdn.net/a.jpg': { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } } });
    const stager = createImageStager({ fetch: f.fn, lookup: publicDns, probe });
    const r = await stager.stage('https://scontent.xx.fbcdn.net/a.jpg');
    expect(r.status).toBe('rejected');
    expect(f.calls).toHaveLength(1);
  });

  test('redirect interno all\'allow-list seguito', async () => {
    const f = fetchFrom({
      'https://scontent.xx.fbcdn.net/a.jpg': { status: 302, headers: { location: 'https://media.cdn.whatsapp.net/b.jpg' } },
      'https://media.cdn.whatsapp.net/b.jpg': { status: 200, body: JPEG },
    });
    const r = await createImageStager({ fetch: f.fn, lookup: publicDns, probe }).stage('https://scontent.xx.fbcdn.net/a.jpg');
    expect(r.status).toBe('downloaded');
  });
});

test.describe('contenuto e deduplica', () => {
  test('tipo verificato sui magic bytes, non sull\'header', async () => {
    expect(sniffImageMime(JPEG)).toBe('image/jpeg');
    expect(sniffImageMime(HTML)).toBeNull();
    const f = fetchFrom({ 'https://scontent.xx.fbcdn.net/a.jpg': { status: 200, body: HTML, headers: { 'content-type': 'image/jpeg' } } });
    const r = await createImageStager({ fetch: f.fn, lookup: publicDns, probe }).stage('https://scontent.xx.fbcdn.net/a.jpg');
    expect(r.status).toBe('rejected');
  });

  test('dimensioni non valide rifiutate', async () => {
    const f = fetchFrom({ 'https://scontent.xx.fbcdn.net/a.jpg': { status: 200, body: JPEG } });
    const r = await createImageStager({ fetch: f.fn, lookup: publicDns, probe: async () => ({ width: 20, height: 20 }) }).stage('https://scontent.xx.fbcdn.net/a.jpg');
    expect(r.status).toBe('rejected');
  });

  test('immagine troppo grande rifiutata', async () => {
    const f = fetchFrom({ 'https://scontent.xx.fbcdn.net/a.jpg': { status: 200, body: JPEG } });
    const r = await createImageStager({ fetch: f.fn, lookup: publicDns, probe }, { maxBytes: 4 }).stage('https://scontent.xx.fbcdn.net/a.jpg');
    expect(r.status).toBe('rejected');
  });

  test('URL scaduto (403) → expired', async () => {
    const f = fetchFrom({ 'https://scontent.xx.fbcdn.net/a.jpg': { status: 403 } });
    const r = await createImageStager({ fetch: f.fn, lookup: publicDns, probe }).stage('https://scontent.xx.fbcdn.net/a.jpg');
    expect(r.status).toBe('expired');
  });

  test('stesso contenuto da URL diversi: un solo file (hash)', async () => {
    const written: string[] = [];
    const f = fetchFrom({
      'https://scontent.xx.fbcdn.net/a.jpg': { status: 200, body: JPEG },
      'https://scontent.xx.fbcdn.net/b.jpg': { status: 200, body: JPEG },
      'https://scontent.xx.fbcdn.net/c.jpg': { status: 200, body: JPEG_B },
    });
    const stager = createImageStager({ fetch: f.fn, lookup: publicDns, probe, writeFile: async (rel) => { written.push(rel); } });
    const a = await stager.stage('https://scontent.xx.fbcdn.net/a.jpg');
    const b = await stager.stage('https://scontent.xx.fbcdn.net/b.jpg');
    const c = await stager.stage('https://scontent.xx.fbcdn.net/c.jpg');
    const again = await stager.stage('https://scontent.xx.fbcdn.net/a.jpg');
    expect(a.status).toBe('downloaded');
    expect(b).toMatchObject({ status: 'duplicate', file: a.file, sha256: a.sha256 });
    expect(c.status).toBe('downloaded');
    expect(again.status).toBe('duplicate');
    expect(written).toHaveLength(2);
    expect(a.file).toMatch(/^images\/[a-f0-9]{64}\.jpg$/);
    expect(f.calls.filter((u) => u.endsWith('/a.jpg'))).toHaveLength(1);
  });

  test('hash noti da un\'esecuzione precedente: nessuna riscrittura', async () => {
    const written: string[] = [];
    const f = fetchFrom({ 'https://scontent.xx.fbcdn.net/a.jpg': { status: 200, body: JPEG } });
    const first = await createImageStager({ fetch: f.fn, lookup: publicDns, probe }).stage('https://scontent.xx.fbcdn.net/a.jpg');
    const known = new Map([[first.sha256 as string, first.file as string]]);
    const r = await createImageStager({ fetch: f.fn, lookup: publicDns, probe, writeFile: async (rel) => { written.push(rel); } }, {}, known)
      .stage('https://scontent.xx.fbcdn.net/a.jpg');
    expect(r.status).toBe('duplicate');
    expect(written).toEqual([]);
  });

  test('dry-run: nessuna scrittura', async () => {
    const written: string[] = [];
    const f = fetchFrom({ 'https://scontent.xx.fbcdn.net/a.jpg': { status: 200, body: JPEG } });
    const r = await createImageStager({ fetch: f.fn, lookup: publicDns, probe, writeFile: async (rel) => { written.push(rel); } }, { dryRun: true })
      .stage('https://scontent.xx.fbcdn.net/a.jpg');
    expect(r.status).toBe('downloaded');
    expect(r.file).toBeNull();
    expect(written).toEqual([]);
  });
});
