import { renderToStaticMarkup } from 'react-dom/server.node';
import { PosterTemplate } from './PosterTemplate';
import type { TenantPaymentMethod, TenantSocialLink } from '@lepefy/types';

interface BuildPosterHtmlParams {
  tenant: {
    name: string;
    logo_url: string | null;
    primary_color: string;
    click_collect_address: string | null;
    click_collect_hours: string | null;
  };
  paymentMethods: TenantPaymentMethod[];
  socialLinks: TenantSocialLink[];
  qrUrl: string;
}

export function buildPosterHtml({ tenant, paymentMethods, socialLinks, qrUrl }: BuildPosterHtmlParams): string {
  const bodyHtml = renderToStaticMarkup(
    PosterTemplate({ tenant, paymentMethods, socialLinks, qrUrl })
  );

  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<style>
  @page { size: 148mm 210mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .poster { width: 148mm; height: 210mm; display: flex; flex-direction: column; }
  .header { padding: 12mm 8mm; text-align: center; color: #fff; }
  .logo { width: 24mm; height: 24mm; border-radius: 50%; background: #fff; object-fit: contain; margin-bottom: 4mm; }
  h1 { margin: 0; font-size: 16pt; }
  .body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5mm; padding: 8mm; text-align: center; }
  .headline { font-size: 14pt; font-weight: 600; margin: 0; color: #111; }
  .headline-it { font-size: 9pt; color: #888; margin: 0; font-style: italic; }
  .qr { width: 70mm; height: 70mm; }
  .methods { display: flex; gap: 6mm; flex-wrap: wrap; justify-content: center; }
  .method { display: flex; flex-direction: column; align-items: center; gap: 1mm; font-size: 8pt; color: #444; }
  .social-row { display: flex; gap: 3mm; justify-content: center; margin-top: 2mm; }
  .social-badge { width: 8mm; height: 8mm; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  .footer { font-size: 8pt; color: #666; margin-top: 4mm; }
</style></head><body>${bodyHtml}</body></html>`;
}
