/**
 * Tenant Android app (TWA) settings: tenants.android_package_name,
 * android_sha256_fingerprint (comma-separated) and android_public.
 * Consumers: /go (Play Store redirect), /.well-known/assetlinks.json and the
 * /card customer email. Pure helpers, shared by the platform admin API, its
 * UI and the notification context.
 */

const ANDROID_PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const SHA256_FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export type AndroidAppStatus = 'none' | 'testing' | 'public';

export function isValidAndroidPackage(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= 150 && ANDROID_PACKAGE.test(value);
}

export function playStoreListingUrl(packageName: string) {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`;
}

/** Same rule as /go: public only with a package name AND android_public. */
export function androidAppStatus(packageName: string | null | undefined, isPublic: boolean | null | undefined): AndroidAppStatus {
  if (!isValidAndroidPackage(packageName?.trim())) return 'none';
  return isPublic ? 'public' : 'testing';
}

/** Stored comma-separated value → list shown to the admin. */
export function splitFingerprints(stored: string | null | undefined) {
  return (stored ?? '').split(',').map((value) => value.trim()).filter(Boolean);
}

/**
 * Admin input (one per line, or comma-separated) → normalized uppercase list.
 * Every entry must be a full SHA-256 certificate fingerprint "AA:BB:…" (32 pairs).
 */
export function parseFingerprints(input: string): { ok: true; values: string[] } | { ok: false; error: string } {
  const values = input.split(/[\s,]+/).map((value) => value.trim().toUpperCase()).filter(Boolean);
  const invalid = values.find((value) => !SHA256_FINGERPRINT.test(value));
  if (invalid) return { ok: false, error: `Empreinte invalide : ${invalid.slice(0, 20)}… (attendu 32 paires hexadécimales AA:BB:…).` };
  if (values.length > 10) return { ok: false, error: '10 empreintes maximum.' };
  return { ok: true, values: [...new Set(values)] };
}

/** What each state does, shown before saving or publishing. */
export function androidAppEffects(status: AndroidAppStatus, hasFingerprints: boolean) {
  return {
    go: status === 'public' ? 'Android → fiche Play Store' : 'Toujours vers la boutique',
    email: status === 'public' ? 'Badge Google Play cliquable' : status === 'testing' ? '« Bientôt disponible sur Google Play »' : 'Aucun bloc application',
    assetLinks: status !== 'none' && hasFingerprints ? 'Servi (vérification du domaine)' : 'Vide',
  };
}

export interface AndroidAppRow {
  id: string;
  name: string;
  slug: string;
  android_package_name: string | null;
  android_sha256_fingerprint: string | null;
  android_public: boolean | null;
}

export const ANDROID_APP_COLUMNS = 'id, name, slug, android_package_name, android_sha256_fingerprint, android_public';

export interface AndroidAppSettings {
  tenant: { name: string; slug: string };
  packageName: string | null;
  fingerprints: string[];
  isPublic: boolean;
  status: AndroidAppStatus;
}

export function serializeAndroidApp(row: AndroidAppRow): AndroidAppSettings {
  return {
    tenant: { name: row.name, slug: row.slug },
    packageName: row.android_package_name,
    fingerprints: splitFingerprints(row.android_sha256_fingerprint),
    isPublic: Boolean(row.android_public),
    status: androidAppStatus(row.android_package_name, row.android_public),
  };
}

export interface AndroidAppPatch {
  packageName?: string | null;
  isPublic?: boolean;
  /** Only honoured with confirm = true (explicit fingerprint edit in the UI). */
  fingerprints?: { value: string; confirm: true };
}

type AndroidAppUpdate = Partial<Pick<AndroidAppRow, 'android_package_name' | 'android_sha256_fingerprint' | 'android_public'>>;

/** Validates a platform-owner patch against the current row; returns the columns to write. */
export function planAndroidAppUpdate(row: AndroidAppRow, input: AndroidAppPatch):
  { ok: true; update: AndroidAppUpdate } | { ok: false; status: 400 | 409; error: string } {
  const update: AndroidAppUpdate = {};

  if (input.packageName !== undefined) {
    const next = input.packageName?.trim() || null;
    if (next !== null && !isValidAndroidPackage(next)) {
      return { ok: false, status: 400, error: 'Package Android invalide (ex. com.exemple.boutique).' };
    }
    if (next !== row.android_package_name) {
      // Repointing a public app would silently change /go and the emails.
      if (row.android_public && input.isPublic !== false) {
        return { ok: false, status: 409, error: 'Repassez l’application en test avant de changer de package.' };
      }
      update.android_package_name = next;
      if (next === null) update.android_public = false;
    }
  }

  if (input.fingerprints) {
    if (input.fingerprints.confirm !== true) return { ok: false, status: 400, error: 'Confirmation requise pour modifier les empreintes.' };
    const fingerprints = parseFingerprints(input.fingerprints.value);
    if (!fingerprints.ok) return { ok: false, status: 400, error: fingerprints.error };
    const next = fingerprints.values.length ? fingerprints.values.join(',') : null;
    if (next !== row.android_sha256_fingerprint) update.android_sha256_fingerprint = next;
  }

  if (input.isPublic !== undefined && update.android_public === undefined && input.isPublic !== Boolean(row.android_public)) {
    const packageName = update.android_package_name !== undefined ? update.android_package_name : row.android_package_name;
    if (input.isPublic && !isValidAndroidPackage(packageName)) {
      return { ok: false, status: 400, error: 'Renseignez le package Android avant de publier.' };
    }
    update.android_public = input.isPublic;
  }

  return { ok: true, update };
}
