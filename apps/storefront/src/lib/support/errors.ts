import { NextResponse } from 'next/server';

/**
 * SQL exceptions raised by the 163 RPCs (`raise exception '<code>'`) mapped to
 * French messages. Anything else becomes a generic error: no internal detail
 * ever reaches the browser.
 */
export const SUPPORT_ERRORS: Record<string, { status: number; message: string }> = {
  support_invalid_input: { status: 400, message: 'Le message est vide ou trop long (5 000 caractères au maximum).' },
  support_rate_limited: { status: 429, message: 'Beaucoup de demandes en peu de temps : réessayez dans quelques minutes.' },
  support_ticket_not_found: { status: 404, message: 'Demande introuvable.' },
  support_ticket_closed: { status: 409, message: 'Cette demande est terminée. Ouvrez une nouvelle demande pour un autre problème.' },
  support_ticket_merged: { status: 409, message: 'Cette demande a été regroupée avec une autre : écrivez dans la demande indiquée.' },
  support_attachment_invalid: { status: 400, message: 'Une capture n’est plus disponible. Retirez-la puis ajoutez-la à nouveau.' },
  support_transition_invalid: { status: 409, message: 'Ce changement de statut n’est pas possible depuis le statut actuel.' },
  support_status_conflict: { status: 409, message: 'La demande vient d’être modifiée par quelqu’un d’autre. Rechargez la page.' },
  support_feedback_not_expected: { status: 409, message: 'Cette demande n’attend plus votre avis.' },
  support_merge_invalid: { status: 400, message: 'Fusion impossible : choisissez une autre demande ouverte de la même boutique.' },
  support_assignee_invalid: { status: 400, message: 'Cette personne ne peut pas être assignée.' },
  support_link_invalid: { status: 400, message: 'Lien GitHub invalide : issue, pull request, commit ou release.' },
};

export function supportErrorCode(error: unknown): string | null {
  const message = (error as { message?: string } | null)?.message ?? '';
  const code = message.match(/support_[a-z_]+/)?.[0] ?? null;
  return code && code in SUPPORT_ERRORS ? code : null;
}

export function supportErrorResponse(error: unknown, fallback = 'L’opération n’a pas abouti. Réessayez.'): NextResponse {
  const code = supportErrorCode(error);
  if (code) {
    const known = SUPPORT_ERRORS[code]!;
    return NextResponse.json({ error: known.message, code }, { status: known.status });
  }
  console.error('[support] unexpected error:', (error as { code?: string } | null)?.code ?? (error instanceof Error ? error.message.slice(0, 120) : 'unknown'));
  return NextResponse.json({ error: fallback }, { status: 500 });
}
