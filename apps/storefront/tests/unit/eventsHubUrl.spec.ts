import { expect, test } from '@playwright/test';
import { eventHref, eventsHubHref, serviceHref } from '../../src/lib/events/eventsHubUrl';

test.describe('liens de la boutique vers l’espace événementiel', () => {
  test('sous-domaine configuré : lien absolu, chemins courts du sous-domaine', () => {
    expect(eventsHubHref('evenements', 'events.chloefood.com')).toBe('https://events.chloefood.com/#evenements');
    expect(eventsHubHref('services', 'events.chloefood.com')).toBe('https://events.chloefood.com/#services');
    expect(eventsHubHref(undefined, 'events.chloefood.com')).toBe('https://events.chloefood.com/');
    expect(eventHref('fete-2026', 'events.chloefood.com')).toBe('https://events.chloefood.com/evenements/fete-2026');
    expect(serviceHref('service-traiteur', 'events.chloefood.com')).toBe('https://events.chloefood.com/services/service-traiteur');
  });

  test('valeur avec protocole, majuscules ou barre finale : même hôte', () => {
    expect(eventsHubHref('services', 'https://Events.ChloeFood.com/')).toBe('https://events.chloefood.com/#services');
  });

  test('sans sous-domaine : routes complètes du domaine boutique', () => {
    expect(eventsHubHref('evenements', null)).toBe('/evenementiel#evenements');
    expect(eventsHubHref('services', '')).toBe('/evenementiel#services');
    expect(eventHref('fete-2026', null)).toBe('/evenementiel/evenements/fete-2026');
    expect(serviceHref('service-traiteur', '  ')).toBe('/evenementiel/services/service-traiteur');
  });
});
