'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { IconDownload, IconFileTypePdf, IconPrinter } from '@tabler/icons-react';
import { needsSharedPdfPrint, pdfDownloadHref, pdfFilenameFromDisposition } from '@/lib/orders/documents/pdfPrintPlatform';
import Button, { ButtonAnchor, buttonClasses, type ButtonSize, type ButtonVariant } from '../ui/Button';
import Dialog from '../ui/Dialog';
import InlineAlert from '../ui/InlineAlert';

/**
 * Order document PDFs on iPhone / iPad (see `pdfPrintPlatform.ts`): printing
 * the PDF from the browser tab crops it and adds the URL, so the PDF is
 * fetched here and handed as a file to the share sheet (« Imprimer »).
 * Two steps on purpose: the share sheet needs a fresh tap, and Gotenberg can
 * take several seconds. Other devices keep the plain link navigation.
 */
interface PdfPrintApi {
  /** true when this device must print through the share sheet. */
  sharedPrint: boolean;
  /** Opens the print sheet for `href` (only meaningful when `sharedPrint`). */
  openPdf: (href: string, title: string) => void;
}

const PdfPrintContext = createContext<PdfPrintApi>({ sharedPrint: false, openPdf: () => {} });

export function usePdfPrint(): PdfPrintApi {
  return useContext(PdfPrintContext);
}

type Job =
  | { href: string; title: string; status: 'loading' }
  | { href: string; title: string; status: 'ready'; file: File; canShare: boolean }
  | { href: string; title: string; status: 'error'; message: string };

export default function PdfPrintProvider({ children }: { children: ReactNode }) {
  const [sharedPrint, setSharedPrint] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Decided after mount: the server HTML and the first client render match.
  useEffect(() => {
    setSharedPrint(needsSharedPdfPrint({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }));
  }, []);

  const openPdf = useCallback((href: string, title: string) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setJob({ href, title, status: 'loading' });
    void (async () => {
      try {
        const response = await fetch(href, { signal: abort.signal, credentials: 'same-origin', headers: { Accept: 'application/pdf' } });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error ?? 'Le document n’a pas pu être généré.');
        }
        const blob = await response.blob();
        const filename = pdfFilenameFromDisposition(response.headers.get('content-disposition'), 'document');
        const file = new File([blob], filename, { type: 'application/pdf' });
        const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
        if (!abort.signal.aborted) setJob({ href, title, status: 'ready', file, canShare });
      } catch (error) {
        if (abort.signal.aborted) return;
        setJob({ href, title, status: 'error', message: error instanceof Error ? error.message : 'Le document n’a pas pu être généré.' });
      }
    })();
  }, []);

  const close = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setJob(null);
  }, []);

  async function share(file: File, title: string) {
    try {
      await navigator.share({ files: [file], title });
    } catch (error) {
      // Closing the share sheet is not an error.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setJob((current) => current && { href: current.href, title: current.title, status: 'error', message: 'Le partage a été refusé par l’appareil. Téléchargez le PDF puis imprimez-le depuis Fichiers.' });
    }
  }

  const api = useMemo<PdfPrintApi>(() => ({ sharedPrint, openPdf }), [sharedPrint, openPdf]);

  return (
    <PdfPrintContext.Provider value={api}>
      {children}
      <Dialog
        open={job !== null}
        onClose={close}
        size="sm"
        icon={<IconFileTypePdf size={20} />}
        title={job?.title ?? 'Document'}
        description={job?.status === 'loading' ? 'Préparation du PDF…' : job?.status === 'ready' ? 'PDF prêt.' : undefined}
        footer={job && (
          <>
            <Button variant="secondary" onClick={close}>Fermer</Button>
            {job.status === 'ready' && job.canShare && (
              <Button variant="primary" onClick={() => void share(job.file, job.title)}>
                <IconPrinter size={16} aria-hidden="true" /> Imprimer…
              </Button>
            )}
            {(job.status === 'error' || (job.status === 'ready' && !job.canShare)) && (
              <ButtonAnchor variant="primary" href={pdfDownloadHref(job.href)}>
                <IconDownload size={16} aria-hidden="true" /> Télécharger le PDF
              </ButtonAnchor>
            )}
            {job.status === 'loading' && <Button variant="primary" loading disabled>Imprimer…</Button>}
          </>
        )}
      >
        {job?.status === 'ready' && job.canShare && (
          <p className="text-sm leading-6 text-a-text-2">
            Touchez « Imprimer… », puis <strong>Imprimer</strong> dans la liste. L’iPhone imprime alors le PDF à sa vraie taille, sans adresse web en haut de page.
          </p>
        )}
        {job?.status === 'ready' && !job.canShare && (
          <p className="text-sm leading-6 text-a-text-2">Téléchargez le PDF, ouvrez-le depuis Fichiers puis utilisez Partager › Imprimer.</p>
        )}
        {job?.status === 'error' && <InlineAlert tone="danger">{job.message}</InlineAlert>}
      </Dialog>
    </PdfPrintContext.Provider>
  );
}

/**
 * Link to an order document PDF. Plain new-tab navigation (works in the PWA)
 * except on iPhone / iPad, where it opens the print sheet above.
 */
export function PdfLink({ href, documentTitle, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; documentTitle: string; children: ReactNode }) {
  const { sharedPrint, openPdf } = usePdfPrint();
  function handle(event: MouseEvent<HTMLAnchorElement>) {
    if (sharedPrint) {
      event.preventDefault();
      openPdf(href, documentTitle);
    }
    onClick?.(event);
  }
  return <a target="_blank" rel="noopener noreferrer" {...rest} href={href} onClick={handle} />;
}

/** `PdfLink` styled as an admin button. */
export function PdfButtonLink({ variant = 'secondary', size = 'md', className, ...rest }: Parameters<typeof PdfLink>[0] & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <PdfLink className={buttonClasses({ variant, size, className })} {...rest} />;
}
