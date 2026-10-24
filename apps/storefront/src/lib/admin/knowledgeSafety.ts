/** Static knowledge must not become a second source of prices, stock or shipping quotes. */
const LIVE_FACT = /(?:\b\d+[\s,.]*€|\b(?:prix|tarif|stock|disponib(?:le|ilité)|livraison)\s*(?:est|sont|:|=)\s*\d|\b\d+\s*(?:euros?|fcfa|xaf)\b)/iu;
const INSTRUCTION = /(?:ignore\s+(?:(?:toutes?|all|previous|précédentes?)\s+)?(?:les\s+)?instructions|system\s*prompt|developer\s*message|révèle\s+(?:le|les)\s+(?:secret|prompt)|<\/?(?:system|developer|assistant)>|\b(?:role|rôle)\s*:\s*(?:system|developer))/iu;

export function knowledgeIssue(content: string): string | null {
  if (content.length > 2000 || !content.trim()) return 'Le contenu doit compter entre 1 et 2 000 caractères.';
  if (INSTRUCTION.test(content)) return 'Ce texte contient une instruction destinée à Nala. Décrivez seulement un fait vérifié.';
  if (LIVE_FACT.test(content)) return 'Les prix, stocks et tarifs actuels doivent venir du catalogue ou du calcul de livraison.';
  return null;
}

export function knowledgeFingerprint(content: string): string {
  return content.normalize('NFKC').toLocaleLowerCase('fr').replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
}
