/**
 * État pur d'une liste de suggestions (motif ARIA « combobox » + « listbox »).
 * Le champ garde le focus ; l'option active est annoncée via
 * aria-activedescendant. Testé sans navigateur.
 */

export interface ComboboxState {
  open: boolean;
  /** -1 = aucune option active (Entrée ne choisit rien). */
  activeIndex: number;
  count: number;
}

export type ComboboxAction =
  | { type: 'results'; count: number }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'hover'; index: number }
  | { type: 'close' }
  | { type: 'reopen' };

export const CLOSED_COMBOBOX: ComboboxState = { open: false, activeIndex: -1, count: 0 };

export function comboboxReducer(state: ComboboxState, action: ComboboxAction): ComboboxState {
  switch (action.type) {
    case 'results':
      return { open: action.count > 0, activeIndex: -1, count: action.count };
    case 'next':
      if (state.count === 0) return state;
      if (!state.open) return { ...state, open: true, activeIndex: 0 };
      return { ...state, activeIndex: (state.activeIndex + 1) % state.count };
    case 'previous':
      if (state.count === 0) return state;
      if (!state.open) return { ...state, open: true, activeIndex: state.count - 1 };
      return { ...state, activeIndex: state.activeIndex <= 0 ? state.count - 1 : state.activeIndex - 1 };
    case 'hover':
      return action.index >= 0 && action.index < state.count ? { ...state, activeIndex: action.index } : state;
    case 'close':
      return { ...state, open: false, activeIndex: -1 };
    case 'reopen':
      return state.count > 0 ? { ...state, open: true } : state;
    default:
      return state;
  }
}

/** Touche clavier → action ; `choose` = Entrée sur une option active. */
export function comboboxKeyAction(key: string, state: ComboboxState): ComboboxAction | 'choose' | null {
  if (key === 'ArrowDown') return { type: 'next' };
  if (key === 'ArrowUp') return { type: 'previous' };
  if (key === 'Escape') return state.open ? { type: 'close' } : null;
  if (key === 'Enter') return state.open && state.activeIndex >= 0 ? 'choose' : null;
  return null;
}
