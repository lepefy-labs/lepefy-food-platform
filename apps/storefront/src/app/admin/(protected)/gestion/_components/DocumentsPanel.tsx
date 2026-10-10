'use client';

import { useRef, useState } from 'react';
import { IconFileDescription, IconPaperclip } from '@tabler/icons-react';
import Button from '../../../_components/ui/Button';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, type DocumentEntityType, type DocumentType } from '@/lib/gestion/domain';
import { formatDate, formatFileSize } from '@/lib/gestion/format';
import { useAdminMutation } from '@/app/admin/_components/ui/useAdminMutation';
import { ErrorText } from '@/app/admin/_components/ui/InlineAlert';
import { hintClasses, controlClasses, labelClasses } from '@/app/admin/_components/ui/Form';

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
  const { run, pending, error } = useAdminMutation();
  const [type, setType] = useState<DocumentType>(defaultType);
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      {documents.length === 0 ? (
        <p className="text-sm text-a-text-3">Aucun document pour le moment.</p>
      ) : (
        <ul className="divide-y divide-a-border">
          {documents.map((document) => {
            const base = `/api/admin/gestion/documents/${document.entity_type}/${document.entity_id}/${document.id}`;
            return (
              <li key={document.id} className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-2.5">
                  <IconFileDescription size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-a-text-3" />
                  <div className="min-w-0">
                    <a href={base} target="_blank" rel="noreferrer" className="break-all text-sm font-medium text-a-brand-fg underline-offset-2 hover:underline">
                      {document.file_name}
                    </a>
                    <p className="text-xs text-a-text-3">
                      {DOCUMENT_TYPE_LABELS[document.document_type]} • {formatFileSize(document.size_bytes)} • {formatDate(document.created_at)}
                      {document.context ? ` • ${document.context}` : ''}
                    </p>
                    {document.note && <p className="mt-0.5 text-xs text-a-text-2">{document.note}</p>}
                  </div>
                </div>
                {canManage && (
                  confirmDelete === document.id ? (
                    <div className="flex gap-2">
                      <Button type="button" size="md" loading={pending} className="min-h-11 !bg-tone-danger-solid"
                        onClick={async () => { await run(base, { method: 'DELETE' }); setConfirmDelete(null); }}>
                        Confirmer la suppression
                      </Button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="min-h-11 px-2 text-sm text-a-text-2">Annuler</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmDelete(document.id)} className="min-h-11 self-start px-2 text-sm text-tone-danger-fg hover:underline sm:self-auto">
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
          className="grid gap-3 rounded-xl border border-a-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
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
            <span className={labelClasses}>Type de document</span>
            <select className={controlClasses} value={type} onChange={(event) => setType(event.target.value as DocumentType)}>
              {allowedTypes.map((value) => <option key={value} value={value}>{DOCUMENT_TYPE_LABELS[value]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={labelClasses}>Fichier</span>
            <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required className={`${controlClasses} file:mr-3 file:rounded-md file:border-0 file:bg-a-hover file:px-2 file:py-1 file:text-sm`} />
            <span className={hintClasses}>PDF, JPEG, PNG ou WebP, 10 Mo au plus. Stockage privé.</span>
          </label>
          <label className="block sm:col-span-2">
            <span className={labelClasses}>Note (optionnelle)</span>
            <input className={controlClasses} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} />
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
