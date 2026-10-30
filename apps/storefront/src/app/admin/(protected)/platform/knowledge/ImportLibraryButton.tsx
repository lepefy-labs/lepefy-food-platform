'use client';

import { useState } from 'react';
import { IconDownload } from '@tabler/icons-react';
import Button from '../../../_components/ui/Button';
import ConfirmDialog from '../../../_components/ui/ConfirmDialog';
import { useAdminMutation } from '../../../_components/ui/useAdminMutation';
import { useAdminToast } from '../../../_components/ui/Toaster';

/** Creates the initial guides as drafts (never published, never overwritten). */
export default function ImportLibraryButton() {
  const [open, setOpen] = useState(false);
  const { run, pending, error } = useAdminMutation();
  const toast = useAdminToast();
  async function confirm() {
    const result = await run<{ created: number; skipped: string[] }>('/api/admin/platform/knowledge/import-library', { successMessage: undefined });
    if (result) {
      setOpen(false);
      toast.success(`${result.created} brouillon${result.created > 1 ? 's' : ''} créé${result.created > 1 ? 's' : ''}${result.skipped.length ? ` · ${result.skipped.length} déjà présent${result.skipped.length > 1 ? 's' : ''}` : ''}.`);
    }
  }
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><IconDownload size={18} aria-hidden="true" />Importer la bibliothèque initiale</Button>
      <ConfirmDialog
        open={open}
        title="Importer la bibliothèque initiale ?"
        description="Les guides en français sont créés comme brouillons. Aucun n’est publié et ceux qui existent déjà ne sont pas modifiés. Relisez-les avant de publier."
        confirmLabel="Importer"
        loading={pending}
        error={error}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
