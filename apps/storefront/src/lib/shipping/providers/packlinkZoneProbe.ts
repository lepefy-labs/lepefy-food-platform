/**
 * Read-only probe of the Packlink geographic contract (GET only, never a
 * POST): what `/locations/postalcodes/{country}/{zip}` and
 * `/locations/postalzones/destinations` return for a few CAPs, to verify how
 * Sicily and Sardinia are represented before relying on it. Returns whitelisted
 * geographic fields and the list of field names the provider sent, never the
 * API key, the raw payload or any address. No `@/` alias: also runnable with
 * Node type stripping.
 */

const BASE = 'https://api.packlink.com/v1';
const MAX_ZIPS = 10;

export interface PacklinkZoneProbeRecord {
  id: string | null;
  zipcode: string | null;
  postalZoneId: string | null;
  city: string | null;
  /** Names of every field of the provider record (to spot state / country variants). */
  fields: string[];
}
export interface PacklinkZoneProbeResult {
  zip: string;
  status: number | 'error';
  records: PacklinkZoneProbeRecord[];
  /** Zone name of each record's postalZoneId, from the destinations list. */
  zoneNames: Array<string | null>;
}
export interface PacklinkZoneProbe {
  zones: Array<{ id: string; name: string | null; isoCode: string | null; fields: string[] }>;
  zonesStatus: number | 'error';
  results: PacklinkZoneProbeResult[];
}

const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const str = (value: unknown, max = 80): string | null => (typeof value === 'string' || typeof value === 'number') && String(value).trim() ? String(value).trim().slice(0, max) : null;

async function get(apiKey: string, path: string): Promise<{ status: number | 'error'; body: unknown }> {
  try {
    const response = await fetch(BASE + path, {
      headers: { Authorization: apiKey, Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8_000),
    });
    const text = await response.text();
    let body: unknown = null;
    try { body = JSON.parse(text.slice(0, 2_000_000)); } catch { /* not JSON */ }
    return { status: response.status, body };
  } catch { return { status: 'error', body: null }; }
}

export async function probePacklinkZones(apiKey: string, country: string, zips: string[], language = 'it_IT'): Promise<PacklinkZoneProbe> {
  const platformCountry = language.split('_')[1] ?? 'IT';
  const zonesReply = await get(apiKey, '/locations/postalzones/destinations?' + new URLSearchParams({
    platform: 'PRO', platform_country: platformCountry, language,
  }));
  const zoneRows = (Array.isArray(zonesReply.body) ? zonesReply.body : []).map(obj);
  const nameOf = (id: string | null) => zoneRows.find((row) => str(row.id) === id)?.name;
  const results: PacklinkZoneProbeResult[] = [];
  for (const zip of zips.slice(0, MAX_ZIPS)) {
    const reply = await get(apiKey, `/locations/postalcodes/${encodeURIComponent(country)}/${encodeURIComponent(zip)}`);
    const records = (Array.isArray(reply.body) ? reply.body : []).slice(0, 50).map(obj).map((row) => ({
      id: str(row.id, 64), zipcode: str(row.zipcode, 40), postalZoneId: str(row.postalZoneId, 16), city: str(obj(row.city).name),
      fields: Object.keys(row).slice(0, 30),
    }));
    results.push({ zip, status: reply.status, records, zoneNames: records.map((record) => str(nameOf(record.postalZoneId))) });
  }
  return {
    zonesStatus: zonesReply.status,
    zones: zoneRows.slice(0, 400).map((row) => ({ id: str(row.id, 16) ?? '', name: str(row.name), isoCode: str(row.isoCode, 8), fields: Object.keys(row).slice(0, 20) })),
    results,
  };
}
