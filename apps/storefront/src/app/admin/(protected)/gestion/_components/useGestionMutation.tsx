'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Mutazione Gestion lato client: una request key stabile per tentativo (un
 * doppio clic o un retry di rete riusano la stessa chiave, quindi il server
 * non registra due volte), rinnovata solo dopo un successo.
 */
export function useGestionMutation() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef<string>(newKey());

  const run = useCallback(async <T = Record<string, unknown>>(
    url: string,
    options: { method?: string; body?: unknown; form?: FormData; withKey?: boolean; refresh?: boolean } = {},
  ): Promise<T | null> => {
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
        setError(json.error ?? 'Une erreur est survenue. Réessayez.');
        return null;
      }
      requestKey.current = newKey();
      if (options.refresh !== false) router.refresh();
      return json;
    } catch {
      setError('Connexion impossible. Vérifiez le réseau puis réessayez.');
      return null;
    } finally {
      setPending(false);
    }
  }, [router]);

  return { run, pending, error, setError };
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">{message}</p>;
}
