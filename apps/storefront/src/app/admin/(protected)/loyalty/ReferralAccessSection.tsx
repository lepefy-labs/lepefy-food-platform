'use client';

import { useState } from 'react';

interface CustomerRow {
  id: string;
  email: string;
  full_name: string | null;
  referral_access_granted: boolean;
  referral_access_reason: string | null;
  referral_suspended: boolean;
}

export function ReferralAccessSection() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setIsSearching(true);
    try {
      const res = await fetch(`/api/admin/loyalty/customers-search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      setResults(data.customers ?? []);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleGrant(customerId: string) {
    setPendingId(customerId);
    try {
      await fetch('/api/admin/loyalty/grant-referral-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId }),
      });
      setResults((prev) =>
        prev.map((c) => (c.id === customerId ? { ...c, referral_access_granted: true, referral_access_reason: 'ADMIN_GRANTED' } : c)),
      );
    } finally {
      setPendingId(null);
    }
  }

  async function handleRevoke(customerId: string) {
    setPendingId(customerId);
    try {
      await fetch('/api/admin/loyalty/revoke-referral-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId }),
      });
      setResults((prev) =>
        prev.map((c) => (c.id === customerId ? { ...c, referral_access_granted: false } : c)),
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Accès parrainage</h2>
      <p className="text-xs text-gray-400 mb-4">
        Recherche par nom ou email — utile pour accorder l&apos;accès manuellement (influenceurs) en mode
        &quot;accordé manuellement uniquement&quot;.
      </p>

      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nom ou email…"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
        <button
          type="submit"
          disabled={isSearching}
          className="px-3 py-2 text-sm rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50"
        >
          Rechercher
        </button>
      </form>

      {results.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 uppercase tracking-wide">
                <th className="py-1.5 font-medium">Client</th>
                <th className="py-1.5 font-medium">Statut</th>
                <th className="py-1.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {results.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-2">
                    <div className="font-medium text-gray-800 dark:text-gray-100">{c.full_name ?? '—'}</div>
                    <div className="text-gray-400">{c.email}</div>
                  </td>
                  <td className="py-2">
                    {c.referral_suspended && <span className="text-red-600">Suspendu (fraude)</span>}
                    {!c.referral_suspended && c.referral_access_granted && (
                      <span className="text-green-600">Accordé ({c.referral_access_reason})</span>
                    )}
                    {!c.referral_suspended && !c.referral_access_granted && (
                      <span className="text-gray-400">Non accordé</span>
                    )}
                  </td>
                  <td className="py-2">
                    {c.referral_access_granted ? (
                      <button
                        onClick={() => handleRevoke(c.id)}
                        disabled={pendingId === c.id}
                        className="px-2.5 py-1 rounded-lg border border-gray-200 text-gray-700 disabled:opacity-50"
                      >
                        Révoquer
                      </button>
                    ) : (
                      <button
                        onClick={() => handleGrant(c.id)}
                        disabled={pendingId === c.id}
                        className="px-2.5 py-1 rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50"
                      >
                        Accorder l&apos;accès
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
