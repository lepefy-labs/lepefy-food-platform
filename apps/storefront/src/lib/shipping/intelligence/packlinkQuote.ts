import { PACKLINK_API_BASE, type PacklinkService } from '@/lib/shipping/calculateShipping';

/**
 * Appel Packlink « services » pour le laboratoire, avec le statut HTTP
 * conservé — contrairement à fetchAllPacklinkServices (flux réel/checkout,
 * inchangé) qui réduit toute erreur à null. Même URL et mêmes paramètres.
 *
 *  - ok       : réponse exploitable (liste éventuellement vide) ;
 *  - rejected : 400/404/422 — Packlink refuse la demande elle-même (constaté :
 *               CAP génériques d'avant réforme, ex. 41100/40100, encore présents
 *               dans GeoNames). Résultat déterministe, pas une panne ;
 *  - error    : réseau, timeout, 5xx, 429, 401/403, JSON invalide — incident
 *               d'infrastructure ou de credential, à signaler.
 */
export type PacklinkServicesResponse =
  | { kind: 'ok'; services: PacklinkService[] }
  | { kind: 'rejected'; status: number }
  | { kind: 'error'; status: number | null };

const REJECTED_STATUSES = new Set([400, 404, 422]);

export async function requestPacklinkServices(
  apiKey: string,
  from: { country: string; zip_code: string },
  to: { country: string; zip_code: string },
  parcels: Array<{ weight: number; width: number; height: number; length: number }>,
  options?: { timeoutMs?: number },
): Promise<PacklinkServicesResponse> {
  const params = new URLSearchParams();
  params.set('from[country]', from.country);
  params.set('from[zip]', from.zip_code);
  params.set('to[country]', to.country);
  params.set('to[zip]', to.zip_code);
  parcels.forEach((p, i) => {
    params.set(`packages[${i}][weight]`, p.weight.toString());
    params.set(`packages[${i}][width]`, p.width.toString());
    params.set(`packages[${i}][height]`, p.height.toString());
    params.set(`packages[${i}][length]`, p.length.toString());
  });

  let res: Response;
  try {
    res = await fetch(`${PACKLINK_API_BASE}/services?${params}`, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(options?.timeoutMs ?? 20_000),
    });
  } catch {
    return { kind: 'error', status: null };
  }

  if (!res.ok) {
    return REJECTED_STATUSES.has(res.status) ? { kind: 'rejected', status: res.status } : { kind: 'error', status: res.status };
  }

  try {
    const services = await res.json() as PacklinkService[] | null;
    return { kind: 'ok', services: Array.isArray(services) ? services : [] };
  } catch {
    return { kind: 'error', status: res.status };
  }
}
