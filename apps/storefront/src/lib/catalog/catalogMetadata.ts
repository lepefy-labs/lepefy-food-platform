import type { Metadata } from 'next';

/**
 * Métadonnées du catalogue `/`, partagées avec `/apercu-catalogue` : la copie
 * servie aux robots d'aperçu de lien (WhatsApp, Facebook) doit annoncer
 * exactement la même page que celle que le client ouvre.
 */
export function catalogMetadata(tenantName: string): Metadata {
  return { title: 'Catalogue', description: `Découvrez les produits de ${tenantName}` };
}
