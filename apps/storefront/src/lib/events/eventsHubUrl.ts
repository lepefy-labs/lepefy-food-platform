// Liens de la boutique vers l'espace événementiel.
//
// Quand le sous-domaine dédié est configuré (NEXT_PUBLIC_EVENTS_SUBDOMAIN, ex.
// events.chloefood.com), on y envoie toujours le client en lien absolu : ses
// pages utilisent des chemins courts (/evenements/…, /services/…) que seuls
// les rewrites de ce sous-domaine savent servir (next.config.mjs). Sans
// sous-domaine, repli sur les routes complètes /evenementiel/… du domaine
// boutique. Fonctions pures : la valeur d'env est lue à l'appel (inlinée au
// build côté client), et peut être passée explicitement pour les tests.

function normalizeHost(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  return raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() || null;
}

function eventsHost(subdomain?: string | null): string | null {
  return normalizeHost(subdomain === undefined ? process.env.NEXT_PUBLIC_EVENTS_SUBDOMAIN : subdomain);
}

/** Accueil de l'espace événementiel, éventuellement sur une section (`evenements`, `services`). */
export function eventsHubHref(section?: string, subdomain?: string | null): string {
  const hash = section ? `#${section}` : '';
  const host = eventsHost(subdomain);
  return host ? `https://${host}/${hash}` : `/evenementiel${hash}`;
}

/** Page d'un événement publié. */
export function eventHref(slug: string, subdomain?: string | null): string {
  const host = eventsHost(subdomain);
  return host ? `https://${host}/evenements/${slug}` : `/evenementiel/evenements/${slug}`;
}

/** Page d'un service (traiteur, location). */
export function serviceHref(slug: string, subdomain?: string | null): string {
  const host = eventsHost(subdomain);
  return host ? `https://${host}/services/${slug}` : `/evenementiel/services/${slug}`;
}
