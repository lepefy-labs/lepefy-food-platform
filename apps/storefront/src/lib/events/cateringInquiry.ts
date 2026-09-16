export const CATERING_FORMATS = ['Buffet convivial', 'Réception privée', 'Événement professionnel'] as const;
export type CateringFormat = typeof CATERING_FORMATS[number];

export function applyCateringFormat(message: string, format: CateringFormat): string {
  const lines = message.split('\n');
  if (CATERING_FORMATS.some((value) => lines[0] === 'Format souhaité : ' + value)) {
    lines.shift();
    if (lines[0] === '') lines.shift();
  }
  const details = lines.join('\n');
  return 'Format souhaité : ' + format + (details ? '\n\n' + details : '');
}
