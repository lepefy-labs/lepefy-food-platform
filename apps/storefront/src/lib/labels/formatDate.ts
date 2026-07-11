export function formatDateIT(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate; // fallback se il formato non è quello atteso
  return `${day}/${month}/${year}`;
}
