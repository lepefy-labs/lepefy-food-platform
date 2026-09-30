'use client';

import { useRef, useState } from 'react';
import { IconFileDescription, IconPaperclip } from '@tabler/icons-react';
import Button from '../../../_components/ui/Button';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, type DocumentEntityType, type DocumentType } from '@/lib/gestion/domain';
import { formatDate, formatFileSize } from '@/lib/gestion/format';
import { ErrorText, useGestionMutation } from './useGestionMutation';
import { HINT_CLS, INPUT_CLS, LABEL_CLS } from './ui';

export interface PanelDocument {
  id: string;
  entity_type: DocumentEntityType;
  entity_id: string;
  document_type: DocumentType;
  file_name: string;
  size_bytes: number;
  note: string | null;
  created_at: string;
  context?: string;
}

/** Liste + ajout de pièces jointes privées (bucket privé, lecture via API autorisée). */
export function DocumentsPanel({ entityType, entityId, documents, canManage, defaultType = 'invoice', allowedTypes = DOCUMENT_TYPES }: {
  entityType: DocumentEntityType; entityId: string; documents: PanelDocument[]; canManage: boolean;
  defaultType?: DocumentType; allowedTypes?: readonly DocumentType[];
}) {
  const { run, pending, error } = useGestionMutation();
  const [type, setType] = useState<DocumentType>(defaultType);
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      {documents.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Aucun document pour le moment.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {documents.map((document) => {
            const base = `/api/admin/gestion/documents/${document.entity_type}/${document.entity_id}/${document.id}`;
            return (
              <li key={document.id} className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-2.5">
                  <IconFileDescription size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
                  <div className="min-w-0">
                    <a href={base} target="_blank" rel="noreferrer" className="break-all text-sm font-medium text-[var(--admin-primary-fg)] underline-offset-2 hover:underline">
                      {document.file_name}
                    </a>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {DOCUMENT_TYPE_LABELS[document.document_type]} • {formatFileSize(document.size_bytes)} • {formatDate(document.created_at)}
                      {document.context ? ` • ${document.context}` : ''}
                    </p>
                    {document.note && <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">{document.note}</p>}
                  </div>
                </div>
                {canManage && (
                  confirmDelete === document.id ? (
                    <div className="flex gap-2">
                      <Button type="button" size="md" loading={pending} className="min-h-11 !bg-red-700"
                        onClick={async () => { await run(base, { method: 'DELETE' }); setConfirmDelete(null); }}>
                        Confirmer la suppression
                      </Button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="min-h-11 px-2 text-sm text-gray-600 dark:text-gray-300">Annuler</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmDelete(document.id)} className="min-h-11 self-start px-2 text-sm text-red-700 hover:underline sm:self-auto dark:text-red-300">
                      Supprimer
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && (
        <form
          className="grid gap-3 rounded-xl border border-gray-200 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] dark:border-gray-700"
          onSubmit={async (event) => {
            event.preventDefault();
            const file = fileRef.current?.files?.[0];
            if (!file) return;
            const form = new FormData();
            form.set('file', file);
            form.set('document_type', type);
            if (note.trim()) form.set('note', note.trim());
            const result = await run(`/api/admin/gestion/documents/${entityType}/${entityId}`, { form });
            if (result) { setNote(''); if (fileRef.current) fileRef.current.value = ''; }
          }}
        >
          <label className="block">
            <span className={LABEL_CLS}>Type de document</span>
            <select className={INPUT_CLS} value={type} onChange={(event) => setType(event.target.value as DocumentType)}>
              {allowedTypes.map((value) => <option key={value} value={value}>{DOCUMENT_TYPE_LABELS[value]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={LABEL_CLS}>Fichier</span>
            <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required className={`${INPUT_CLS} file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-2 file:py-1 file:text-sm dark:file:bg-gray-800 dark:file:text-gray-200`} />
            <span className={HINT_CLS}>PDF, JPEG, PNG ou WebP, 10 Mo au plus. Stockage privé.</span>
          </label>
          <label className="block sm:col-span-2">
            <span className={LABEL_CLS}>Note (optionnelle)</span>
            <input className={INPUT_CLS} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} />
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" loading={pending} className="min-h-11"><IconPaperclip size={16} aria-hidden="true" />Ajouter le document</Button>
            <ErrorText message={error} />
          </div>
        </form>
      )}
    </div>
  );
}
