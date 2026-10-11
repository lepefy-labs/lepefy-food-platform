'use client';

import type { ReactNode } from 'react';
import type { ComboboxState } from './comboboxState';

export function optionId(listId: string, index: number) {
  return `${listId}-option-${index}`;
}

/** Attributs ARIA du champ qui pilote la liste. */
export function comboboxInputProps(listId: string, state: ComboboxState) {
  return {
    role: 'combobox' as const,
    'aria-autocomplete': 'list' as const,
    'aria-expanded': state.open,
    'aria-controls': listId,
    'aria-activedescendant': state.open && state.activeIndex >= 0 ? optionId(listId, state.activeIndex) : undefined,
  };
}

interface SuggestionListProps<T> {
  id: string;
  label: string;
  items: T[];
  state: ComboboxState;
  getKey: (item: T) => string;
  render: (item: T) => ReactNode;
  onChoose: (item: T) => void;
  onHover: (index: number) => void;
}

/**
 * Liste de suggestions dans le flux de la page (elle pousse le contenu au
 * lieu de passer sous la barre fixe ou le clavier). Options de 48 px ;
 * mousedown n'enlève pas le focus du champ.
 */
export function SuggestionList<T>({ id, label, items, state, getKey, render, onChoose, onHover }: SuggestionListProps<T>) {
  return (
    <ul
      id={id}
      role="listbox"
      aria-label={label}
      hidden={!state.open || items.length === 0}
      className="overflow-hidden rounded-xl border-[1.5px] bg-white"
      style={{ borderColor: 'var(--field-border)' }}
    >
      {items.map((item, index) => {
        const active = index === state.activeIndex;
        return (
          <li
            key={getKey(item)}
            id={optionId(id, index)}
            role="option"
            aria-selected={active}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onHover(index)}
            onClick={() => onChoose(item)}
            className="flex min-h-12 cursor-pointer items-start gap-3 border-b border-gray-200 px-3.5 py-2.5 last:border-b-0"
            style={active
              ? { backgroundColor: 'color-mix(in srgb, var(--color-primary) 9%, white)', boxShadow: 'inset 3px 0 0 var(--color-primary)' }
              : undefined}
          >
            {render(item)}
          </li>
        );
      })}
    </ul>
  );
}
