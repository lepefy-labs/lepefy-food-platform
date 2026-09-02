import { CONFIG, FOOD_CODES } from './config';
import { normalizeText } from './deduplication';
import { cacheKey, providerJson } from './providers';
import { getCache, putCache } from './repository';
import type { DiscoveryFilters, DiscoveryPage, DiscoveryProvider, Identity } from './types';
type Establishment = {
  siret?:string; activite_principale?:string; etat_administratif?:string; statut_diffusion_etablissement?:string;
  region?:string; departement?:string; libelle_commune?:string; code_postal?:string; adresse?:string;
  latitude?:string; longitude?:string; nom_commercial?:string; liste_enseignes?:string[];
};
type Company = { nombre_etablissements_ouverts?:number; siren?:string; nom_complet?:string; nom_raison_sociale?:string; etat_administratif?:string;
  statut_diffusion?:string; matching_etablissements?:Establishment[]; siege?:Establishment };
export type SireneResponse = { results:Company[]; total_pages:number };
export function mapSirene(data:SireneResponse,filters:DiscoveryFilters):Identity[] {
  const candidates:Identity[] = [];
  for (const company of data.results ?? []) {
    if (company.statut_diffusion && company.statut_diffusion !== 'O') continue;
    if (filters.activeOnly && company.etat_administratif !== 'A') continue;
    const establishments = company.matching_etablissements?.length ? company.matching_etablissements : company.siege ? [company.siege] : [];
    for (const e of establishments) {
      if (!e.siret || !/^\d{14}$/.test(e.siret) || (e.statut_diffusion_etablissement && e.statut_diffusion_etablissement !== 'O')) continue;
      if (filters.activeOnly && e.etat_administratif !== 'A') continue;
      if (!e.activite_principale || !filters.codes.includes(e.activite_principale)) continue;
      // The API activity filter is legal-unit scoped. Revalidate every returned establishment.
      const department = e.departement ?? (e.code_postal?.startsWith('20') ? (Number(e.code_postal) < 20200 ? '2A' : '2B') : e.code_postal?.startsWith('97') ? e.code_postal.slice(0,3) : e.code_postal?.slice(0,2));
      if (filters.region && e.region !== filters.region) continue;
      if (filters.department && department !== filters.department) continue;
      if (filters.city && !normalizeText(e.libelle_commune ?? '').startsWith(normalizeText(filters.city))) continue;
      const coordinate = (v:string | undefined,max:number) => v && Number.isFinite(Number(v)) && Math.abs(Number(v)) <= max ? Number(v) : null;
      candidates.push({ business_name:(e.nom_commercial || e.liste_enseignes?.[0] || company.nom_complet || company.nom_raison_sociale || e.siret).slice(0,300),
        legal_name:company.nom_raison_sociale?.slice(0,300) ?? null, siren:company.siren, siret:e.siret,
        naf_ape_code:e.activite_principale, business_category:FOOD_CODES[e.activite_principale] ?? null,
        country:'FR', region:e.region ?? null, department:department ?? null, city:e.libelle_commune ?? null,
        postal_code:e.code_postal ?? null, address:e.adresse ?? null, latitude:coordinate(e.latitude,90), longitude:coordinate(e.longitude,180),
        has_multiple_locations:typeof company.nombre_etablissements_ouverts === 'number' ? company.nombre_etablissements_ouverts > 1 : null,
        discovery_source:'sirene/recherche-entreprises', source_external_id:e.siret });
    }
  }
  return candidates;
}
export const sireneProvider:DiscoveryProvider = {
  async discover(filters,page):Promise<DiscoveryPage> {
    const key = cacheKey('sirene',{filters,page}); const cached = await getCache<DiscoveryPage>(key); if (cached) return cached;
    const url = new URL('https://recherche-entreprises.api.gouv.fr/search');
    url.searchParams.set('activite_principale',filters.codes.join(','));
    url.searchParams.set('minimal','true'); url.searchParams.set('include','matching_etablissements,siege');
    url.searchParams.set('per_page','5'); url.searchParams.set('limite_matching_etablissements','100');
    url.searchParams.set('page',String(page));
    if (filters.activeOnly) url.searchParams.set('etat_administratif','A');
    if (filters.region) url.searchParams.set('region',filters.region);
    if (filters.department) url.searchParams.set('departement',filters.department);
    if (filters.city) url.searchParams.set('q',filters.city);
    const data = await providerJson<SireneResponse>(url.href,'sirene',2);
    if (!Array.isArray(data.results) || !Number.isFinite(data.total_pages)) throw new Error('Réponse SIRENE invalide.');
    const result = { candidates:mapSirene(data,filters), nextPage:page < data.total_pages ? page+1 : null };
    await putCache(key,result,CONFIG.sireneDays*86400); return result;
  },
};
