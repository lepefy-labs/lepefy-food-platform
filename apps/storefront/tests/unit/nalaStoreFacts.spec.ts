import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { resolveNalaFastStoreInformation } from '../../src/lib/ai/nalaFastResolver';
import { buildNalaStoreFactsText, closuresSentence, nalaStoreFactsRevision } from '../../src/lib/ai/nalaStoreFacts';
import { buildSystemPrompt } from '../../src/lib/ai/chatbox';

const FACTS = {
  hoursText: 'Lun–Sam : 9h–20h · Dim : 10h–19h',
  closures: [{ from: '2026-12-25', to: '2026-12-25', label: 'Noël' }],
  pickupEnabled: true,
  pickupAddress: 'Via Angelo Zanti 1, 42122 Reggio Emilia',
  deliveryCountries: ['IT', 'FR', 'PT'],
  appInstallUrl: 'https://shop.example/app',
};

test.describe('faits du magasin pour Nala', () => {
  test('horaires de la grille, fermetures, retrait, pays du checkout et application', () => {
    const text = buildNalaStoreFactsText(FACTS);
    expect(text).toContain('Lun–Sam : 9h–20h · Dim : 10h–19h');
    expect(text).toContain('y compris pour le dimanche');
    expect(text).toContain('Fermetures exceptionnelles à venir : le ');
    expect(text).toContain('(Noël)');
    expect(text).toContain('Via Angelo Zanti 1');
    expect(text).toMatch(/Pays de livraison acceptés au paiement : Italie, France, Portugal\./);
    expect(text).toContain('https://shop.example/app');
    expect(text).toContain("Ne dis jamais qu'il n'y a rien à installer");
  });

  test('sans horaires : Nala ne doit en inventer aucun', () => {
    const text = buildNalaStoreFactsText({ ...FACTS, hoursText: null, closures: [], appInstallUrl: null, deliveryCountries: null });
    expect(text).toContain('Ne donne aucun horaire');
    expect(text).not.toContain('Pays de livraison');
    expect(text).not.toContain('Application');
  });

  test('une longue liste de pays devient « tous les pays desservis », jamais un nombre', () => {
    const many = Array.from({ length: 245 }, (_, i) => `A${String.fromCharCode(65 + (i % 26))}`);
    const text = buildNalaStoreFactsText({ ...FACTS, deliveryCountries: many });
    expect(text).toContain('tous les pays desservis par notre transporteur');
    expect(text).toContain('Ne cite jamais un nombre de pays');
    expect(text).not.toMatch(/\b245\b/);
  });

  test('la révision change dès qu’un fait change (cache des réponses invalidé)', () => {
    const a = nalaStoreFactsRevision(buildNalaStoreFactsText(FACTS));
    const b = nalaStoreFactsRevision(buildNalaStoreFactsText({ ...FACTS, hoursText: 'Lun–Sam : 9h–19h' }));
    expect(a).not.toBe(b);
    expect(a).toBe(nalaStoreFactsRevision(buildNalaStoreFactsText(FACTS)));
  });

  test('fermetures en français et en italien', () => {
    const closures = [{ from: '2026-08-10', to: '2026-08-24', label: 'Congés' }];
    expect(closuresSentence(closures, 'fr')).toMatch(/^du .+ au .+ \(Congés\)$/);
    expect(closuresSentence(closures, 'it')).toMatch(/^dal .+ al .+ \(Congés\)$/);
    expect(closuresSentence([], 'fr')).toBeNull();
  });

  test('le prompt place les faits avant le contexte écrit à la main, qui ne peut plus les contredire', () => {
    const prompt = buildSystemPrompt({
      tenantName: 'Chloe Food', locales: ['fr'], whatsappNumber: null,
      extraContext: 'Horaires : Lun-Sam 9h00-19h00, fermé le dimanche.',
      storeFacts: buildNalaStoreFactsText(FACTS),
      matchedProducts: [], knowledgeSnippets: [],
    });
    const factsAt = prompt.indexOf('Faits actuels du magasin (SOURCE DE VÉRITÉ');
    expect(factsAt).toBeGreaterThan(0);
    expect(factsAt).toBeLessThan(prompt.indexOf('Informations sur le magasin :'));
    // Exclusifs sur leurs sujets : une liste de pays écrite à la main ne doit plus être reprise.
    expect(prompt).toContain('les pays de livraison et l\'application, utilise UNIQUEMENT ces faits');
    expect(prompt).toContain('Ignore tout ce que les informations plus bas ou les connaissances disent sur ces sujets');
  });

  test('« Aidez-moi à composer mon panier » est un indice du prompt, plus un préfixe du message', () => {
    const guided = buildSystemPrompt({ tenantName: 'X', locales: ['fr'], whatsappNumber: null, extraContext: null, matchedProducts: [], knowledgeSnippets: [], guidedCartStart: true });
    expect(guided).toContain('« Aidez-moi à composer mon panier »');
    expect(guided).toContain('réponds simplement à cette question sans parler de panier');
    const widget = readFileSync(path.join(__dirname, '../../src/components/chat/ChatWidget.tsx'), 'utf8');
    expect(widget).not.toContain('Aide-moi à composer mon panier avec');
    expect(widget).toContain("guided: 'cart'");
  });
});

test.describe('réponses directes (sans IA)', () => {
  const tenant = {
    click_collect_hours: 'Lun–Sam : 9h–20h · Dim : 10h–19h',
    click_collect_hours_it: 'Lun–Sab : 9h–20h · Dom : 10h–19h',
    click_collect_address: 'Via Angelo Zanti 1',
    whatsapp_number: null,
    chatbox_extra_context: null,
  };
  const extras = { tenantName: 'Chloe Food', closuresText: 'le 25 déc. (Noël)', appInstallUrl: 'https://shop.example/app' };

  test('« comment je vais télécharger cette application » → page /app, jamais « rien à télécharger »', () => {
    for (const message of ['comment je vais télécharger cette application', "Je peux installer l'appli ?", "Posso scaricare l'app?", 'How do I install the app']) {
      const result = resolveNalaFastStoreInformation({ message, locale: 'fr', tenant, extras });
      expect(result?.subject, message).toBe('app_install');
      expect(result?.reply, message).toContain('https://shop.example/app');
    }
    expect(resolveNalaFastStoreInformation({ message: "Posso scaricare l'app?", locale: 'it', tenant, extras })?.reply)
      .toBe('Puoi installare Chloe Food sul telefono, gratis e senza passare da uno store: trovi i passaggi qui https://shop.example/app');
  });

  test('sans page /app connue, pas de réponse directe sur l’application', () => {
    expect(resolveNalaFastStoreInformation({ message: "télécharger l'application", locale: 'fr', tenant, extras: { ...extras, appInstallUrl: null } })).toBeNull();
  });

  test('les horaires citent les fermetures exceptionnelles à venir', () => {
    expect(resolveNalaFastStoreInformation({ message: 'vous ouvrez à quelle heure ?', locale: 'fr', tenant, extras })?.reply)
      .toBe('Nos horaires sont : Lun–Sam : 9h–20h · Dim : 10h–19h Fermetures exceptionnelles : le 25 déc. (Noël).');
  });
});
