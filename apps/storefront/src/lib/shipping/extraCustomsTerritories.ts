/**
 * Territori extra-doganali: fanno parte del paese ma sono fuori dal territorio
 * doganale/IVA UE. Packlink non restituisce alcun servizio a domicilio verso
 * questi CAP (verificato il 23/09/2026 da origine IT 42122).
 *
 * Serve soltanto a rendere esplicito il messaggio «livraison indisponible»:
 * non cambia né la disponibilità né il prezzo, che restano decisi da Packlink.
 */
const EXTRA_CUSTOMS_POSTAL_CODES: Record<string, Record<string, string>> = {
  IT: {
    '23041': 'Livigno',
    '22061': "Campione d'Italia",
  },
};

export function extraCustomsTerritory(country: string, postalCode: string): string | null {
  const codes = EXTRA_CUSTOMS_POSTAL_CODES[country.trim().toUpperCase()];
  return codes?.[postalCode.trim()] ?? null;
}

export function extraCustomsUnavailableMessage(territory: string, clickCollectEnabled: boolean): string {
  const alternative = clickCollectEnabled
    ? 'Choisissez le retrait en magasin ou contactez-nous.'
    : 'Contactez-nous pour trouver une solution.';
  return `Livraison indisponible vers ${territory} (zone extra-douanière). ${alternative}`;
}
