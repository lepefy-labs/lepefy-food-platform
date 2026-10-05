'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '../../_components/ui/Button';

interface CustomerRow {
  id: string;
  email: string;
  full_name: string | null;
  is_ambassador: boolean;
}

export function PromoteAmbassadorSection() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerRow[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) {
      setMessage({ text: 'Saisissez au moins 2 caractères.', tone: 'error' });
      return;
    }
    setIsSearching(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/ambassador/customers-search?q=${encodeURIComponent(query.trim())}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setMessage({ text: body?.error ?? 'Recherche indisponible.', tone: 'error' });
        return;
      }
      const data = await res.json() as { customers?: CustomerRow[] };
      setResults(data.customers ?? []);
    } catch {
      setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setIsSearching(false);
    }
  }

  async function handlePromote(customer: CustomerRow) {
    setPendingId(customer.id);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/ambassador/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: customer.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setMessage({ text: body?.error ?? 'Nomination impossible.', tone: 'error' });
        return;
      }
      setResults((prev) => (prev ?? []).map((c) => (c.id === customer.id ? { ...c, is_ambassador: true } : c)));
      setMessage({ text: `${customer.full_name || customer.email} est maintenant ambassadeur. Son lien d’invitation est actif.`, tone: 'ok' });
      router.refresh();
    } catch {
      setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">Nommer un ambassadeur</h2>
      <p className="mb-4 text-xs text-gray-400">
        Seul un administrateur peut nommer un ambassadeur. Le client doit déjà avoir un compte sur la boutique.
      </p>

      <form onSubmit={handleSearch} className="mb-4 flex gap-2">
        <label htmlFor="ambassador-search" className="sr-only">Nom ou e-mail du client</label>
        <input
          id="ambassador-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nom ou e-mail…"
          className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
        <Button type="submit" loading={isSearching}>Rechercher</Button>
      </form>

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-3 py-2 text-xs ${message.tone === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{message.text}</p>
      )}

      {results && results.length === 0 && <p className="text-sm text-gray-400">Aucun client trouvé.</p>}

      {results && results.length > 0 && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {results.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="font-medium text-gray-800 dark:text-gray-100">{c.full_name ?? '—'}</div>
                <div className="truncate text-gray-400">{c.email}</div>
              </div>
              {c.is_ambassador
                ? <span className="shrink-0 text-green-700">Déjà ambassadeur</span>
                : <Button size="sm" onClick={() => void handlePromote(c)} loading={pendingId === c.id}>Nommer ambassadeur</Button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
