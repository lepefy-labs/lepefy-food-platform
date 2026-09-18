import { renderToStaticMarkup } from 'react-dom/server.node';
import { PosterTemplate } from './PosterTemplate';
import type { TenantPaymentMethod, TenantSocialLink } from '@lepefy/types';

interface BuildPosterHtmlParams {
  tenant: {
    name: string;
    logo_url: string | null;
    primary_color: string;
    secondary_color: string;
    click_collect_address: string | null;
    click_collect_hours: string | null;
    whatsapp_number: string | null;
  };
  paymentMethods: TenantPaymentMethod[];
  socialLinks: TenantSocialLink[];
  qrUrl: string;
  readableUrl: string;
}

export function buildPosterHtml({ tenant, paymentMethods, socialLinks, qrUrl, readableUrl }: BuildPosterHtmlParams): string {
  const bodyHtml = renderToStaticMarkup(
    PosterTemplate({ tenant, paymentMethods, socialLinks, qrUrl, readableUrl })
  );

  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<style>
  @page { size: 148mm 210mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; height: 210mm; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .poster { width: 148mm; height: 210mm; display: flex; flex-direction: column; overflow: hidden; page-break-after: avoid; page-break-inside: avoid; }
  .header { padding: 7mm 8mm 5mm; text-align: center; color: #fff; }
  .logo { width: 22mm; height: 22mm; border-radius: 50%; background: #fff; object-fit: contain; margin-bottom: 2mm; }
  h1 { margin: 0; font-size: 16pt; }
  .header-accent { width: 12mm; height: 1mm; border-radius: 1mm; margin: 2mm auto 0; }
  .body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.5mm; padding: 4mm; text-align: center; }
  .headline { font-size: 14pt; font-weight: 600; margin: 0; color: #111; }
  .headline-it { font-size: 9pt; color: #888; margin: 0; font-style: italic; }
  .qr-frame { padding: 1mm; border: 0.4mm solid; border-radius: 3mm; }
  .qr { display: block; width: 70mm; height: 70mm; }
  .qr-url { font-size: 9pt; color: #555; margin: -1mm 0 0; word-break: break-all; }
  .whatsapp { display: flex; align-items: center; gap: 2mm; font-size: 9.5pt; font-weight: 600; color: #111; }
  .methods-block { display: flex; flex-direction: column; align-items: center; gap: 1mm; }
  .methods-label { font-size: 8.5pt; font-weight: 600; color: #444; margin: 0; }
  .methods-accent { width: 8mm; height: 0.8mm; border-radius: 1mm; }
  .methods-label-it { font-size: 7.5pt; font-style: italic; color: #999; margin: 0 0 1mm; }
  .methods { display: flex; gap: 6mm; flex-wrap: wrap; justify-content: center; }
  .method { display: flex; flex-direction: column; align-items: center; gap: 1mm; font-size: 8pt; color: #444; }
  .social-row { display: flex; gap: 3mm; justify-content: center; margin-top: 1mm; }
  .social-badge { width: 8mm; height: 8mm; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  .footer { font-size: 10pt; color: #444; margin-top: 2mm; }
</style></head><body>${bodyHtml}</body></html>`;
}
