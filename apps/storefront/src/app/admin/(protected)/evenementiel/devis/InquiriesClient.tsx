'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ServiceInquiryStatus } from '@lepefy/types';
import InquiryMetrics from './_components/InquiryMetrics';
import InquiryToolbar from './_components/InquiryToolbar';
import InquiryList from './_components/InquiryList';
import InquiryDetail from './_components/InquiryDetail';
import type { InquiryFilter, InquiryWithService } from './inquiryTypes';
import { STATUS_PRIORITY } from './inquiryTypes';

function matchesFilter(status: ServiceInquiryStatus, filter: InquiryFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'new') return status === 'nouveau';
  if (filter === 'actionable') return ['nouveau', 'a_contacter'].includes(status);
  if (filter === 'followup') return ['contacte', 'devis_envoye'].includes(status);
  return ['accepte', 'refuse', 'clos'].includes(status);
}

function sortOperational(a: InquiryWithService, b: InquiryWithService): number {
  const aClosed = ['accepte', 'refuse', 'clos'].includes(a.status);
  const bClosed = ['accepte', 'refuse', 'clos'].includes(b.status);
  if (aClosed !== bClosed) return aClosed ? 1 : -1;

  const priorityDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
  if (priorityDiff !== 0) return priorityDiff;

  if (aClosed && bClosed) return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

export default function InquiriesClient({ initialInquiries }: { initialInquiries: InquiryWithService[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedId = searchParams.get('request');

  const [inquiries, setInquiries] = useState(initialInquiries);
  const [filter, setFilter] = useState<InquiryFilter>('all');
  const [search, setSearch] = useState('');
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [noteSavingId, setNoteSavingId] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr');
    return [...inquiries]
      .filter((inquiry) => matchesFilter(inquiry.status, filter))
      .filter((inquiry) => {
        if (!query) return true;
        return `${inquiry.customer_name} ${inquiry.customer_email} ${inquiry.customer_phone ?? ''} ${inquiry.service_offerings?.title ?? ''}`
          .toLocaleLowerCase('fr')
          .includes(query);
      })
      .sort(sortOperational);
  }, [filter, inquiries, search]);

  const requestedInquiry = requestedId ? filtered.find((item) => item.id === requestedId) ?? null : null;
  const desktopSelected = requestedInquiry ?? filtered[0] ?? null;

  useEffect(() => {
    if (!requestedId) return;
    const stillVisible = filtered.some((item) => item.id === requestedId);
    if (!stillVisible) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('request');
      const query = params.toString();
      router.replace(query ? `?${query}` : '?', { scroll: false });
    }
  }, [filtered, requestedId, router, searchParams]);

  function selectInquiry(id: string) {
    setStatusError(null);
    setNoteError(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set('request', id);
    router.push(`?${params.toString()}`, { scroll: false });
  }

  function closeMobileDetail() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('request');
    const query = params.toString();
    router.push(query ? `?${query}` : '?', { scroll: false });
  }

  async function updateStatus(id: string, status: ServiceInquiryStatus) {
    setStatusError(null);
    setStatusSavingId(id);
    try {
      const res = await fetch(`/api/admin/evenementiel/inquiries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const result = await res.json();
      if (!res.ok) {
        setStatusError(result.error ?? 'Impossible de mettre à jour le statut.');
        return;
      }
      setInquiries((prev) => prev.map((item) => item.id === id ? result as InquiryWithService : item));
    } catch {
      setStatusError('Impossible de mettre à jour le statut.');
    } finally {
      setStatusSavingId(null);
    }
  }

  async function saveNote(id: string, internalNotes: string | null): Promise<boolean> {
    setNoteError(null);
    setNoteSavingId(id);
    try {
      const res = await fetch(`/api/admin/evenementiel/inquiries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internal_notes: internalNotes }),
      });
      const result = await res.json();
      if (!res.ok) {
        setNoteError(result.error ?? 'Impossible d’enregistrer la note.');
        return false;
      }
      setInquiries((prev) => prev.map((item) => item.id === id ? result as InquiryWithService : item));
      return true;
    } catch {
      setNoteError('Impossible d’enregistrer la note.');
      return false;
    } finally {
      setNoteSavingId(null);
    }
  }

  if (inquiries.length === 0) {
    return <div className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">Aucune demande pour le moment.</div>;
  }

  return (
    <div className="space-y-3">
      <div className={requestedInquiry ? 'hidden lg:block' : 'block'}>
        <div className="space-y-3">
          <InquiryMetrics inquiries={inquiries} />
          <InquiryToolbar search={search} onSearchChange={setSearch} filter={filter} onFilterChange={setFilter} />
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,.8fr)] lg:items-start lg:gap-4">
        <div className={requestedInquiry ? 'hidden lg:block' : 'block'}>
          <InquiryList inquiries={filtered} selectedId={desktopSelected?.id ?? null} onSelect={selectInquiry} />
        </div>

        <div className={requestedInquiry ? 'block' : 'hidden lg:block'}>
          {desktopSelected ? (
            <InquiryDetail
              inquiry={requestedInquiry ?? desktopSelected}
              onBack={requestedInquiry ? closeMobileDetail : undefined}
              onStatusChange={(status) => updateStatus((requestedInquiry ?? desktopSelected).id, status)}
              statusSaving={statusSavingId === (requestedInquiry ?? desktopSelected).id}
              statusError={statusError}
              onSaveNote={(note) => saveNote((requestedInquiry ?? desktopSelected).id, note)}
              noteSaving={noteSavingId === (requestedInquiry ?? desktopSelected).id}
              noteError={noteError}
            />
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">Sélectionnez une demande pour afficher les détails.</div>
          )}
        </div>
      </div>
    </div>
  );
}
