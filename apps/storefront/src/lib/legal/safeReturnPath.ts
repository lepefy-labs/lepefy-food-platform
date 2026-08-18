// Valide un paramètre `return` reçu depuis l'URL avant de rediriger dessus —
// doit être un chemin interne (commence par un seul '/'), jamais une URL
// absolue ni un chemin protocole-relatif (`//evil.com` est interprété par le
// navigateur comme `https://evil.com`, classique vecteur d'open redirect).
export function safeReturnPath(raw: string | string[] | undefined, fallback = '/compte'): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}
