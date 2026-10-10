'use client';

import { useState } from 'react';
import Button from '../../_components/ui/Button';
import ConfirmDialog from '../../_components/ui/ConfirmDialog';
import { referralAccessReasonLabel } from '@/lib/loyalty/loyaltyAdmin';

interface CustomerRow {
  id: string;
  email: string;
  full_name: string | null;
  referral_access_granted: boolean;
  referral_access_reason: string | null;
  referral_suspended: boolean;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function ReferralAccessSection() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerRow[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<CustomerRow | null>(null);
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
      const res = await fetch(`/api/admin/loyalty/customers-search?q=${encodeURIComponent(query.trim())}`);
      if (!res.ok) {
        setMessage({ text: await errorMessage(res, 'Recherche indisponible.'), tone: 'error' });
        return;
      }
      const data = await res.json();
      setResults(data.customers ?? []);
    } catch {
      setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setIsSearching(false);
    }
  }

  // The row changes only after the server confirmed.
  async function updateAccess(customer: CustomerRow, grant: boolean) {
    setPendingId(customer.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/loyalty/${grant ? 'grant' : 'revoke'}-referral-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: customer.id }),
      });
      if (!res.ok) {
        setMessage({ text: await errorMessage(res, 'Mise à jour impossible.'), tone: 'error' });
        return;
      }
      setResults((previous) => (previous ?? []).map((row) => (row.id === customer.id
        ? { ...row, referral_access_granted: grant, referral_access_reason: grant ? (row.referral_access_reason ?? 'ADMIN_GRANTED') : row.referral_access_reason }
        : row)));
      setMessage({ text: grant ? `Accès accordé à ${customer.full_name || customer.email}.` : `Accès révoqué pour ${customer.full_name || customer.email}.`, tone: 'ok' });
    } catch {
      setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setPendingId(null);
      setRevokeTarget(null);
    }
  }

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Accès parrainage</h2>
      <p className="text-xs text-gray-400 mb-4">
        Recherche par nom ou e-mail — pour accorder l&apos;accès manuellement (influenceurs, partenaires), notamment en mode
        « Seulement les clients autorisés manuellement ».
      </p>

      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <label htmlFor="referral-access-search" className="sr-only">Nom ou e-mail du client</label>
        <input
          id="referral-access-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nom ou e-mail…"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        />
        <Button type="submit" loading={isSearching}>Rechercher</Button>
      </form>

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-3 py-2 text-xs ${message.tone === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{message.text}</p>
      )}

      {results && results.length === 0 && <p className="text-sm text-gray-400">Aucun client trouvé.</p>}

      {results && results.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400">
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
                    {c.referral_suspended && <span className="text-red-600">Suspendu (anti-fraude)</span>}
                    {!c.referral_suspended && c.referral_access_granted && (
                      <span className="text-green-600">{referralAccessReasonLabel(c.referral_access_reason)}</span>
                    )}
                    {!c.referral_suspended && !c.referral_access_granted && <span className="text-gray-400">Non accordé</span>}
                  </td>
                  <td className="py-2">
                    {c.referral_access_granted ? (
                      <Button variant="outline" size="sm" onClick={() => setRevokeTarget(c)} loading={pendingId === c.id}>Révoquer…</Button>
                    ) : (
                      <Button size="sm" onClick={() => void updateAccess(c, true)} loading={pendingId === c.id}>Accorder l&apos;accès</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Révoquer l'accès au parrainage ?"
        description={`${revokeTarget?.full_name || revokeTarget?.email || 'Ce client'} ne pourra plus parrainer de nouveaux clients. Les points déjà gagnés sont conservés.`}
        confirmLabel="Révoquer"
        cancelLabel="Annuler"
        destructive
        loading={revokeTarget !== null && pendingId === revokeTarget.id}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => { if (revokeTarget) void updateAccess(revokeTarget, false); }}
      />
    </section>
  );
}
