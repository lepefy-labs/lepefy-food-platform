// Detects work that no component registered explicitly, so a reload never
// destroys it: (1) a form field the user has typed into, (2) a write request
// (POST/PUT/PATCH/DELETE) still in flight. Installed once by PwaLifecycle.
// Reads nothing from the server and never alters a request or its response.

import { acquireBusy } from './busyRegistry';

const touchedFields = new Set<Element>();

function isEditable(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target.hasAttribute('data-pwa-ignore') || target.closest('[data-pwa-ignore]')) return false;
  if (target instanceof HTMLInputElement) {
    if (['search', 'hidden', 'checkbox', 'radio', 'range', 'button', 'submit'].includes(target.type)) return false;
    if (target.getAttribute('role') === 'searchbox' || target.getAttribute('role') === 'combobox') return false;
    return Boolean(target.form);
  }
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return Boolean(target.form);
  return target.isContentEditable;
}

function pruneTouched() {
  touchedFields.forEach((el) => { if (!el.isConnected) touchedFields.delete(el); });
}

/** True while a field the user edited is still on the page. */
export function hasTouchedFields(): boolean {
  pruneTouched();
  return touchedFields.size > 0;
}

/** Call on route change: fields of the previous page no longer matter. */
export function resetTouchedFields(): void {
  touchedFields.clear();
}

/** True when an editable (non-search) form control is mounted. */
export function hasEditableForm(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector(
    'form input:not([type=search]):not([type=hidden]):not([type=checkbox]):not([type=radio]):not([data-pwa-ignore]), form textarea, form select',
  ) !== null;
}

let installed = false;

export function installActivityTracker(): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;

  const onInput = (event: Event) => {
    if (isEditable(event.target)) touchedFields.add(event.target);
  };
  const onSubmit = (event: Event) => {
    // A submit is handled by the write tracker below; the typed values are sent.
    if (event.target instanceof HTMLFormElement) {
      touchedFields.forEach((el) => { if (event.target instanceof HTMLFormElement && event.target.contains(el)) touchedFields.delete(el); });
    }
  };
  document.addEventListener('input', onInput, true);
  document.addEventListener('submit', onSubmit, true);

  const originalFetch = window.fetch.bind(window);
  window.fetch = function trackedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return originalFetch(input, init);
    const release = acquireBusy('write-in-flight');
    let promise: Promise<Response>;
    try {
      promise = originalFetch(input, init);
    } catch (error) {
      release();
      throw error;
    }
    return promise.finally(release);
  };

  return () => {
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('submit', onSubmit, true);
    window.fetch = originalFetch;
    touchedFields.clear();
    installed = false;
  };
}
