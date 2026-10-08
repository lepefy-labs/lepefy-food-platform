import type { ExternalCatalogProvider } from '../types';
import { ExternalCatalogError } from '../types';
import type { GreenApiDeps } from './greenApi';
import { createGreenApiCatalogProvider, readGreenApiConfig } from './greenApi';

/**
 * Selezione del provider da `WHATSAPP_CATALOG_PROVIDER` (default `green_api`).
 * Un nuovo provider implementa `ExternalCatalogProvider` e si aggiunge qui:
 * normalizzazione, parser, staging immagini e report non cambiano.
 */
export function getExternalCatalogProvider(
  env: Record<string, string | undefined>,
  deps: GreenApiDeps = {},
): ExternalCatalogProvider {
  const id = (env.WHATSAPP_CATALOG_PROVIDER?.trim() || 'green_api').toLowerCase();
  switch (id) {
    case 'green_api':
      return createGreenApiCatalogProvider(readGreenApiConfig(env), deps);
    default:
      throw new ExternalCatalogError('CONFIG_INVALID', `WHATSAPP_CATALOG_PROVIDER sconosciuto: ${id}.`);
  }
}
