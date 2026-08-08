'use client';

import { useState } from 'react';
import { IconMail, IconPhone, IconUsers, IconCalendar } from '@tabler/icons-react';
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

const STATUS_COLORS: Record<ServiceInquiryStatus, string> = {
  nouveau: 'bg-blue-100 text-blue-700',
  contacte: 'bg-amber-100 text-amber-700',
  clos: 'bg-gray-100 text-gray-500',
};

export default function InquiriesClient({ initialInquiries }: { initialInquiries: InquiryWithService[] }) {
  const [inquiries, setInquiries] = useState(initialInquiries);

  async function updateStatus(id: string, status: ServiceInquiryStatus) {
    const res = await fetch(`/api/admin/evenementiel/inquiries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setInquiries((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    }
  }

  if (inquiries.length === 0) {
    return (
      <p className="text-sm text-gray-400 bg-white rounded-2xl border border-gray-100 p-6 text-center">
        Aucune demande pour le moment.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {inquiries.map((inquiry) => (
        <div key={inquiry.id} className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <p className="text-sm font-semibold text-gray-900">{inquiry.customer_name}</p>
              <p className="text-xs text-gray-500">{inquiry.service_offerings?.title ?? 'Service'}</p>
            </div>
            <select
              value={inquiry.status}
              onChange={(e) => updateStatus(inquiry.id, e.target.value as ServiceInquiryStatus)}
              className={`text-2xs font-semibold px-2 py-1 rounded-full border-0 ${STATUS_COLORS[inquiry.status]}`}
            >
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-gray-500 mb-2">
            <span className="flex items-center gap-1"><IconMail size={13} /> {inquiry.customer_email}</span>
            {inquiry.customer_phone && <span className="flex items-center gap-1"><IconPhone size={13} /> {inquiry.customer_phone}</span>}
            {inquiry.date_souhaitee && <span className="flex items-center gap-1"><IconCalendar size={13} /> {new Date(inquiry.date_souhaitee).toLocaleDateString('fr-FR')}</span>}
            {inquiry.nombre_invites && <span className="flex items-center gap-1"><IconUsers size={13} /> {inquiry.nombre_invites} invités</span>}
          </div>

          {inquiry.message && <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{inquiry.message}</p>}
        </div>
      ))}
    </div>
  );
}
