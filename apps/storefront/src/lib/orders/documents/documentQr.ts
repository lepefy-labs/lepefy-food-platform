import QRCode from 'qrcode';

/**
 * QR inline (SVG) pour les documents PDF : généré localement avec la
 * bibliothèque `qrcode` déjà utilisée par /api/shop/qr-code et la carte —
 * aucun appel HTTP pendant le rendu Gotenberg. Correction M : robuste à une
 * impression laser/jet d'encre sans densifier inutilement le motif.
 * La taille physique est fixée par le CSS du document (≥ 30 mm).
 */
export async function qrSvg(url: string): Promise<string> {
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0, color: { dark: '#000000', light: '#ffffff' } });
  // Taille pilotée par le conteneur : on retire width/height fixes éventuels.
  return svg.replace(/<svg([^>]*?)\s(width|height)="[^"]*"/g, '<svg$1').replace(/<svg([^>]*?)\s(width|height)="[^"]*"/g, '<svg$1');
}
