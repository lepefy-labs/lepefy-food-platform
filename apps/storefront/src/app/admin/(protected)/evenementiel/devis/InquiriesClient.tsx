'use client';

import { useMemo, useState } from 'react';
import { IconCalendar, IconMail, IconPhone, IconSearch, IconUsers } from '@tabler/icons-react';
import type { ServiceInquiryStatus } from '@lepefy/types';

interface InquiryWithService {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  date_souhaitee: string | null;
  nombre_invites: number | null;
  message: string | null;
  status: ServiceInquiryStatus;
  created_at: string;
  service_offerings: { title: string; slug: string } | null;
}

const STATUS_OPTIONS: ServiceInquiryStatus[] = ['nouveau', 'contacte', 'clos'];
const STATUS_LABELS: Record<ServiceInquiryStatus, string> = { nouveau: 'Nouveau', contacte: 'Contacté', clos: 'Clos' };
const STATUS_COLORS: Record<ServiceInquiryStatus, string> = {
  nouveau: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  contacte: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  clos: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300',
};

export default function InquiriesClient({ initialInquiries }: { initialInquiries: InquiryWithService[] }) {
  const [inquiries, setInquiries] = useState(initialInquiries);
  const [statusFilter, setStatusFilter] = useState<'all' | ServiceInquiryStatus>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr');
    return [...inquiries]
      .filter((inquiry) => statusFilter === 'all' || inquiry.status === statusFilter)
      .filter((inquiry) => !query || `${inquiry.customer_name} ${inquiry.customer_email}`.toLocaleLowerCase('fr').includes(query))
      .sort((a, b) => {
        if (a.status === 'nouveau' && b.status !== 'nouveau') return -1;
        if (b.status === 'nouveau' && a.status !== 'nouveau') return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [inquiries, search, statusFilter]);

  async function updateStatus(id: string, status: ServiceInquiryStatus) {
    const res = await fetch(`/api/admin/evenementiel/inquiries/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    if (res.ok) setInquiries((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Rechercher par client ou email</span>
          <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Client ou email…" className="min-h-11 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
        </label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | ServiceInquiryStatus)} className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200">
          <option value="all">Tous les statuts</option>
          {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">Aucune demande correspondante.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {filtered.map((inquiry) => (
              <article key={inquiry.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{inquiry.customer_name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{inquiry.service_offerings?.title ?? 'Service'} · {new Date(inquiry.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p>
                  </div>
                  <select value={inquiry.status} onChange={(e) => updateStatus(inquiry.id, e.target.value as ServiceInquiryStatus)} aria-label={`Statut de la demande de ${inquiry.customer_name}`} className={`min-h-11 rounded-lg border-0 px-3 text-xs font-semibold ${STATUS_COLORS[inquiry.status]}`}>
                    {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                  </select>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
                  <span className="flex items-center gap-1"><IconMail size={13} /> {inquiry.customer_email}</span>
                  {inquiry.customer_phone && <span className="flex items-center gap-1"><IconPhone size={13} /> {inquiry.customer_phone}</span>}
                  {inquiry.date_souhaitee && <span className="flex items-center gap-1"><IconCalendar size={13} /> {new Date(inquiry.date_souhaitee).toLocaleDateString('fr-FR')}</span>}
                  {inquiry.nombre_invites != null && <span className="flex items-center gap-1"><IconUsers size={13} /> {inquiry.nombre_invites} invités</span>}
                </div>
                {inquiry.message && <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700 dark:bg-gray-800/70 dark:text-gray-200">{inquiry.message}</p>}
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
