export function formatPrice(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
}

export function formatDate(dateStr: string, locale = 'fr-FR'): string {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(dateStr));
}

export function slugify(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
