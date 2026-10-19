'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconFileTypePdf, IconPrinter } from '@tabler/icons-react';
import type { OrderDocumentFormat } from '@/lib/orders/documents/formats';
import { START_SKIP_LABELS, type StartResult } from '@/lib/orders/preparation/preparationPolicy';
import Button, { ButtonAnchor } from '../../../_components/ui/Button';
import { Card } from '../../../_components/ui/Panel';
import { useAdminToast } from '../../../_components/ui/Toaster';
import { FormatSelect } from '../../../orders/[id]/OrderDocumentsCard';

/**
 * Documents of the session. « Imprimer et démarrer » first records the start
 * (POST, idempotent), then opens the individual lists; the plain links only
 * open PDFs and record nothing.
 */
export default function PreparationSessionActions({ orderIds, canManage, defaultFormat, notPrinted }: {
  orderIds: string[];
  canManage: boolean;
  defaultFormat: OrderDocumentFormat;
  notPrinted: number;
}) {
  const router = useRouter();
  const toast = useAdminToast();
  const [format, setFormat] = useState<OrderDocumentFormat>(defaultFormat);
  const [pending, setPending] = useState(false);
  const pdf = (kind: 'picking-list' | 'preparation-summary', ids = orderIds) => `/api/admin/orders/documents/${kind}?ids=${ids.join(',')}&format=${format}`;

  async function printAndStart() {
    // Opened in the click handler so the browser does not block it, filled once the start is recorded.
    const tab = window.open('', '_blank');
    setPending(true);
    try {
      const response = await fetch('/api/admin/orders/preparation/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderIds }),
      });
      const body = await response.json().catch(() => null) as (StartResult & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error ?? 'Impossible de démarrer la préparation.');
      if (body.ready.length > 0) {
        if (tab) tab.location.href = pdf('picking-list', body.ready);
        else window.location.href = pdf('picking-list', body.ready);
      } else tab?.close();
      const skipped = body.skipped.map((entry) => `#${entry.id.slice(0, 8).toUpperCase()} : ${START_SKIP_LABELS[entry.reason]}`);
      toast.success(`${body.ready.length} commande${body.ready.length > 1 ? 's' : ''} en préparation`, {
        description: [body.started.length ? `${body.started.length} démarrée${body.started.length > 1 ? 's' : ''} maintenant.` : null, skipped.length ? `Écartées — ${skipped.join(' · ')}` : null].filter(Boolean).join(' '),
      });
      router.refresh();
    } catch (error) {
      tab?.close();
      toast.error(error instanceof Error ? error.message : 'Impossible de démarrer la préparation.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <FormatSelect value={format} onChange={setFormat} label="Format d’impression" />
        {canManage && notPrinted > 0 && <p className="text-xs text-a-text-3">{notPrinted} commande{notPrinted > 1 ? 's' : ''} sans liste imprimée.</p>}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <ButtonAnchor href={pdf('preparation-summary')} target="_blank" rel="noopener noreferrer">
          <IconFileTypePdf size={16} aria-hidden="true" /> Liste groupée<span className="sr-only"> (PDF, nouvel onglet)</span>
        </ButtonAnchor>
        <ButtonAnchor href={pdf('picking-list')} target="_blank" rel="noopener noreferrer" title="Ouvre les listes sans rien enregistrer">
          <IconFileTypePdf size={16} aria-hidden="true" /> Listes individuelles<span className="sr-only"> (PDF, nouvel onglet)</span>
        </ButtonAnchor>
        {canManage && (
          <Button onClick={() => void printAndStart()} loading={pending}>
            <IconPrinter size={16} aria-hidden="true" /> Imprimer et démarrer la préparation
          </Button>
        )}
      </div>
    </Card>
  );
}
