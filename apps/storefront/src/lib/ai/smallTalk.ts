/**
 * Intercetta saluti/small talk banali PRIMA di qualsiasi chiamata AI.
 * Contenuto placeholder generico — da sostituire con frasi autentiche del
 * tenant (es. da Dalice) non appena disponibili, idealmente promuovendole
 * a voci `tenant_knowledge_base` categoria 'greeting' in una fase successiva.
 */

const GREETING_PATTERNS = [
  /^(salut|bonjour|bonsoir|coucou|hello|hi|ciao)\s*!?\.?$/i,
  /^(merci|merci beaucoup|thanks|grazie)\s*!?\.?$/i,
  /^(ça va|ca va|comment ça va|come va)\s*\??\.?$/i,
];

const GREETING_REPLIES = [
  'Bonjour ! Bienvenue chez {tenantName} 👋 Comment puis-je vous aider ?',
  'Salut ! Je suis là pour vous aider à trouver ce qu\'il vous faut chez {tenantName}.',
  'Bonjour ! Une question sur nos produits ou notre boutique ?',
];

const THANKS_REPLIES = [
  'Avec plaisir ! N\'hésitez pas si vous avez d\'autres questions.',
  'Je vous en prie ! Je reste disponible si besoin.',
];

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Retourne une réponse statique si le message est du small talk pur,
 * sinon `null` (le message doit alors suivre le pipeline AI complet).
 */
export function matchSmallTalk(message: string, tenantName: string): string | null {
  const normalized = normalize(message);

  const isThanks = /^(merci|merci beaucoup|thanks|grazie)/i.test(normalized);
  if (isThanks) {
    const pick = THANKS_REPLIES[Math.floor(Math.random() * THANKS_REPLIES.length)]!;
    return pick;
  }

  const isGreeting = GREETING_PATTERNS.some(p => p.test(normalized));
  if (isGreeting) {
    const pick = GREETING_REPLIES[Math.floor(Math.random() * GREETING_REPLIES.length)]!;
    return pick.replace('{tenantName}', tenantName);
  }

  return null;
}
