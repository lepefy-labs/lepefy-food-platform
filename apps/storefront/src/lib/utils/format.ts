export function formatPrice(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
}

export function formatDate(dateStr: string, locale = 'fr-FR'): string {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(dateStr));
}

// Jour de la semaine + date, ex. "Samedi 29 août 2026" — meta bar hero événement
// (058). Intl rend le jour en minuscule ("samedi") en fr-FR, capitalisé ici
// pour respecter la convention typographique du mockup.
export function formatEventDayDate(dateStr: string, locale = 'fr-FR'): string {
  const formatted = new Intl.DateTimeFormat(locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(dateStr));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

// Heure seule, ex. "18:30" — meta bar hero événement (058). Pas d'heure de fin :
// `events` n'a qu'une colonne `date_start`, aucun `date_end` en base.
export function formatEventTime(dateStr: string, locale = 'fr-FR'): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(dateStr));
}

export function slugify(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
