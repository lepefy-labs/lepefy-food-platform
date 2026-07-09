'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  IconCheck, IconX, IconPlus, IconCopy, IconTrash, IconFileText, IconClock, IconArrowLeft,
} from '@tabler/icons-react';
import type { LabelPrintJob } from '@lepefy/types';

interface LabelJobsListProps {
  productId: string;
  productName: string;
  jobs: LabelPrintJob[];
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function LabelJobsListClient({ productId, productName, jobs }: LabelJobsListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isCreating, setIsCreating] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (searchParams.get('msg') === 'already_generated') {
      showToast('Cette étiquette a déjà été générée — utilisez « Dupliquer pour réimpression ».', 'error');
      router.replace(`/admin/products/${productId}/etichetta`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
  }

  const drafts = jobs.filter((j) => j.status === 'draft');
  const generated = jobs.filter((j) => j.status === 'generated');

  async function createJob(duplicateFromId?: string) {
    setIsCreating(true);
    try {
      const res = await fetch('/api/admin/labels/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, duplicateFromId }),
      });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? 'Échec de la création');

      router.push(`/admin/products/${productId}/etichetta/${data.id}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Échec de la création', 'error');
      setIsCreating(false);
    }
  }

  async function discardDraft(jobId: string) {
    if (!confirm('Abandonner ce brouillon ?')) return;

    setPendingId(jobId);
    try {
      const res = await fetch(`/api/admin/labels/jobs/${jobId}`, { method: 'DELETE' });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Échec de la suppression');

      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Échec de la suppression', 'error');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Link
            href={`/admin/catalogue/${productId}`}
            className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1 mb-1"
          >
            <IconArrowLeft size={14} />
            Retour au produit
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Étiquettes — {productName}</h1>
          <p className="text-sm text-gray-400 mt-0.5">Brouillons et historique des étiquettes générées</p>
        </div>
        <button
          onClick={() => createJob()}
          disabled={isCreating}
          className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <IconPlus size={16} />
          Nouvelle étiquette
        </button>
      </div>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Brouillons en cours</h2>
        {drafts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-5 text-sm text-gray-400">
            Aucun brouillon en cours.
          </div>
        ) : (
          <div className="space-y-2">
            {drafts.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between gap-4 bg-white rounded-xl border border-gray-200 p-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <IconClock size={18} className="text-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {job.lot_number || 'Lot non renseigné'}
                    </p>
                    <p className="text-xs text-gray-400">Dernier enregistrement : {formatDateTime(job.updated_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`/admin/products/${productId}/etichetta/${job.id}`}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Reprendre
                  </Link>
                  <button
                    onClick={() => discardDraft(job.id)}
                    disabled={pendingId === job.id}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                    title="Abandonner le brouillon"
                  >
                    <IconTrash size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Étiquettes générées</h2>
        {generated.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-5 text-sm text-gray-400">
            Aucune étiquette générée pour ce produit.
          </div>
        ) : (
          <div className="space-y-2">
            {generated.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between gap-4 bg-white rounded-xl border border-gray-200 p-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <IconFileText size={18} className="text-[var(--color-primary)] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      Lot {job.lot_number} — {job.quantity} étiquette{job.quantity && job.quantity > 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-gray-400">
                      {job.durability_date ? `À consommer avant le ${formatDate(job.durability_date)} · ` : ''}
                      Généré le {formatDateTime(job.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {job.pdf_url && (
                    <a
                      href={job.pdf_url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Voir le PDF
                    </a>
                  )}
                  <button
                    onClick={() => createJob(job.id)}
                    disabled={isCreating}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-900 text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    <IconCopy size={14} />
                    Dupliquer pour réimpression
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all ${
            toast.type === 'success' ? 'bg-[var(--color-primary)]' : 'bg-red-500'
          }`}
        >
          {toast.type === 'success' ? <IconCheck size={16} /> : <IconX size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
