export interface EventCheckinWindow {
  checkin_opens_at?: string | null;
  checkin_closes_at?: string | null;
}

export interface EventCheckinWindowState {
  openAt: string | null;
  closeAt: string | null;
  blockingReason: string | null;
}

function validIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function getEventCheckinWindowState(
  event: EventCheckinWindow,
  now = new Date(),
): EventCheckinWindowState {
  const openAt = validIso(event.checkin_opens_at);
  const closeAt = validIso(event.checkin_closes_at);
  const nowMs = now.getTime();

  if (openAt && nowMs < new Date(openAt).getTime()) {
    return { openAt, closeAt, blockingReason: 'Le contrôle des billets n’est pas encore ouvert.' };
  }
  if (closeAt && nowMs > new Date(closeAt).getTime()) {
    return { openAt, closeAt, blockingReason: 'La fenêtre de contrôle des billets est terminée.' };
  }

  return { openAt, closeAt, blockingReason: null };
}
