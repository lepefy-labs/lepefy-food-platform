import type { createServiceClient } from '@/lib/supabase/server';
import { readZipEntries } from './unzip';

type ServiceClient = ReturnType<typeof createServiceClient>;

export const IMPORTABLE_COUNTRIES = ['IT', 'FR', 'DE', 'BE', 'CH'] as const;

const BATCH_SIZE = 1000;

export function normalizePlaceName(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

interface PostalCodeRow {
  country: string;
  postal_code: string;
  place_name: string;
  place_name_normalized: string;
  admin_name1: string | null;
  admin_code1: string | null;
  admin_name2: string | null;
  admin_code2: string | null;
  latitude: number | null;
  longitude: number | null;
}

function parseGeoNamesTxt(country: string, text: string): PostalCodeRow[] {
  const rows: PostalCodeRow[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const cols = line.split('\t');
    const [countryCode, postalCode, placeName, admin1Name, admin1Code, admin2Name, admin2Code, , , lat, lng] = cols;
    if (!countryCode || !postalCode || !placeName) continue;

    rows.push({
      country: countryCode.trim().toUpperCase(),
      postal_code: postalCode.trim().toUpperCase(),
      place_name: placeName.trim(),
      place_name_normalized: normalizePlaceName(placeName),
      admin_name1: admin1Name?.trim() || null,
      admin_code1: admin1Code?.trim() || null,
      admin_name2: admin2Name?.trim() || null,
      admin_code2: admin2Code?.trim() || null,
      latitude: lat ? Number(lat) : null,
      longitude: lng ? Number(lng) : null,
    });
  }
  return rows;
}

/**
 * Télécharge l'export ZIP statique GeoNames pour un pays
 * (download.geonames.org/export/zip, licence CC BY 4.0) et le charge dans
 * shipping_postal_code_index. Remplace les appels réseau live
 * (Nominatim/Zippopotam/GeoNames) faits à chaque recherche admin par un
 * simple SELECT local — voir postalCityLookup.ts.
 */
export async function importCountryPostalCodes(
  supabase: ServiceClient,
  countryInput: string,
): Promise<{ country: string; rowCount: number }> {
  const country = countryInput.trim().toUpperCase();

  const response = await fetch(`https://download.geonames.org/export/zip/${country}.zip`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`download_failed_${country}_status_${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const entries = readZipEntries(buffer);
  const txtEntry = entries.find((e) => e.name.toUpperCase() === `${country}.TXT`) ?? entries.find((e) => e.name.endsWith('.txt'));
  if (!txtEntry) throw new Error(`no_txt_entry_in_zip_for_${country}`);

  const rows = parseGeoNamesTxt(country, txtEntry.data.toString('utf8'));

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('shipping_postal_code_index')
      .upsert(batch, { onConflict: 'country,postal_code,place_name', ignoreDuplicates: true });
    if (error) throw new Error(`upsert_failed_${country}_batch_${i}: ${error.message}`);
  }

  return { country, rowCount: rows.length };
}
