'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminToast } from './Toaster';

export interface AdminMutationOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  /** Adds a stable `requestKey` (idempotent retries: a double click reuses it). */
  withKey?: boolean;
  /** router.refresh() after success (default true). */
  refresh?: boolean;
  /** Toast shown after success. */
  successMessage?: string;
  /** Also show the error as a toast (default false: the caller shows `error` inline). */
  errorToast?: boolean;
}

const NETWORK_ERROR = 'Connexion impossible. Vérifiez le réseau puis réessayez.';
const GENERIC_ERROR = 'Une erreur est survenue. Réessayez.';

/**
 * Client-side admin write: pending state, French error from the API
 * (`{ error }`), optional toast and router.refresh(). The request key stays
 * the same across retries of one attempt and is renewed only after a success.
 */
export function useAdminMutation() {
  const router = useRouter();
  const toast = useAdminToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef<string>(newKey());

  const run = useCallback(async <T = Record<string, unknown>>(url: string, options: AdminMutationOptions = {}): Promise<T | null> => {
    setPending(true);
    setError(null);
    try {
      const body = options.form
        ?? (options.body !== undefined || options.withKey
          ? JSON.stringify(options.withKey ? { ...(options.body as object), requestKey: requestKey.current } : options.body)
          : undefined);
      const response = await fetch(url, {
        method: options.method ?? 'POST',
        headers: options.form ? undefined : { 'Content-Type': 'application/json' },
        body,
      });
      const json = await response.json().catch(() => ({})) as T & { error?: string };
      if (!response.ok) {
        const message = json.error ?? GENERIC_ERROR;
        setError(message);
        if (options.errorToast) toast.error(message);
        return null;
      }
      requestKey.current = newKey();
      if (options.successMessage) toast.success(options.successMessage);
      if (options.refresh !== false) router.refresh();
      return json;
    } catch {
      setError(NETWORK_ERROR);
      if (options.errorToast) toast.error(NETWORK_ERROR);
      return null;
    } finally {
      setPending(false);
    }
  }, [router, toast]);

  return { run, pending, error, setError };
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
