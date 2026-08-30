export interface EventCheckinWindow {
  date_start?: string | null;
  status?: 'draft' | 'published' | 'closed' | 'cancelled' | string | null;
  checkin_opens_at?: string | null;
  checkin_closes_at?: string | null;
}

export interface EventCheckinWindowState {
  openAt: string | null;
  closeAt: string | null;
  blockingReason: string | null;
}

const DEFAULT_CHECKIN_DURATION_HOURS = 12;

function validIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function getDefaultEventCheckinClosesAt(dateStart: string): string | null {
  const startAt = validIso(dateStart);
  if (!startAt) return null;
  return new Date(new Date(startAt).getTime() + DEFAULT_CHECKIN_DURATION_HOURS * 3_600_000).toISOString();
}

export function getEventCheckinWindowState(
  event: EventCheckinWindow,
  now = new Date(),
): EventCheckinWindowState {
  const openAt = validIso(event.checkin_opens_at);
  const explicitCloseAt = validIso(event.checkin_closes_at);
  const closeAt = explicitCloseAt ?? (event.date_start ? getDefaultEventCheckinClosesAt(event.date_start) : null);
  const nowMs = now.getTime();

  if (event.status === 'cancelled') {
    return { openAt, closeAt, blockingReason: 'Événement annulé.' };
  }
  if (event.status === 'draft') {
    return { openAt, closeAt, blockingReason: 'Événement non publié.' };
  }
  if (event.status === 'closed') {
    return { openAt, closeAt, blockingReason: 'Le billet n’est plus valide : l’événement est terminé.' };
  }
  if (openAt && nowMs < new Date(openAt).getTime()) {
    return { openAt, closeAt, blockingReason: 'Le contrôle des billets n’est pas encore ouvert.' };
  }
  if (closeAt && nowMs > new Date(closeAt).getTime()) {
    return { openAt, closeAt, blockingReason: 'Le billet n’est plus valide : l’événement est terminé.' };
  }

  return { openAt, closeAt, blockingReason: null };
}
