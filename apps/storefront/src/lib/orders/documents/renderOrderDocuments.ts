import { NextResponse } from 'next/server';
import type { Tenant } from '@lepefy/types';
import type { createServiceClient } from '@/lib/supabase/server';
import { getAdminWorkspaceUrls } from '@/lib/admin/workspace';
import { htmlToPdf, GotenbergConversionError, GotenbergUnavailableError } from '@/lib/labels/gotenberg';
import {
  getOrCreateOrderPublicTokens, orderPortalDisplayUrl, orderPortalUrl, PortalTokenUnavailableError,
} from '@/lib/orders/portal/orderPublicToken';
import { documentFooterHtml, escapeHtml, orderShortRef } from './documentHtml';
import { qrSvg } from './documentQr';
import { MAX_BULK_ORDER_DOCUMENTS, ORDER_DOCUMENT_FORMATS, type OrderDocumentFormat } from './formats';

export { MAX_BULK_ORDER_DOCUMENTS };
import { loadOrderDocumentData, OrderDocumentDataError } from './loadOrderDocumentData';
import { packingSlipHtml } from './packingSlipHtml';
import { pickingListHtml } from './pickingListHtml';
import type { OrderDocumentsConfig } from './settings';
import { buildPackingSlipViewModel, buildPickingListViewModel, type DocumentTenant, type PackingSlipQrVM } from './viewModels';

type ServiceClient = ReturnType<typeof createServiceClient>;

export type OrderDocumentKind = 'picking_list' | 'packing_slip';

/** Segment d'URL des routes ↔ type de document. */
export const ORDER_DOCUMENT_ROUTE_KINDS: Record<string, OrderDocumentKind> = {
  'picking-list': 'picking_list',
  'packing-slip': 'packing_slip',
};

const GOTENBERG_TIMEOUT_MS = 25_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OrderDocumentError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'OrderDocumentError';
  }
}

/** Lecture de `?ids=` : ordre conservé, doublons et valeurs non UUID écartés. */
export function parseOrderIdList(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const value of (raw ?? '').split(',')) {
    const id = value.trim().toLowerCase();
    if (UUID.test(id)) seen.add(id);
  }
  return Array.from(seen);
}

export function isOrderUuid(value: string): boolean {
  return UUID.test(value);
}

export function orderDocumentFilename(kind: OrderDocumentKind, format: OrderDocumentFormat, scope: { orderId: string } | { date: Date }): string {
  const label = kind === 'picking_list' ? 'preparation' : 'bon-de-colis';
  if ('orderId' in scope) return `commande-${orderShortRef(scope.orderId)}-${label}-${format}.pdf`;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(scope.date);
  return `${kind === 'picking_list' ? 'preparation' : 'bons-de-colis'}-${day}-${format}.pdf`;
}

function documentTenant(tenant: Tenant): DocumentTenant {
  return {
    name: tenant.name,
    logo_url: tenant.logo_url,
    primary_color: tenant.primary_color,
    currency: tenant.currency,
    storefront_url: tenant.storefront_url,
    whatsapp_number: tenant.whatsapp_number,
    legal_email: tenant.legal_email,
    android_package_name: tenant.android_package_name,
    android_public: tenant.android_public,
  };
}

async function packingSlipQrs(db: ServiceClient, tenant: Tenant, orderIds: string[]): Promise<{ qrs: Map<string, PackingSlipQrVM>; unavailable: boolean }> {
  const qrs = new Map<string, PackingSlipQrVM>();
  const base = getAdminWorkspaceUrls(tenant).shopBaseUrl;
  if (!base) {
    console.warn('[order-documents] QR omitted: no storefront URL', tenant.id);
    return { qrs, unavailable: true };
  }
  try {
    const tokens = await getOrCreateOrderPublicTokens(db, tenant.id, orderIds);
    for (const [orderId, token] of Array.from(tokens.entries())) {
      const url = orderPortalUrl(base, token);
      qrs.set(orderId, { url, displayUrl: orderPortalDisplayUrl(url), svg: await qrSvg(url) });
    }
    return { qrs, unavailable: qrs.size < orderIds.length };
  } catch (error) {
    // Jamais le jeton dans les logs : seulement la cause.
    if (error instanceof PortalTokenUnavailableError) {
      console.warn('[order-documents] QR omitted:', error.message, tenant.id);
      return { qrs, unavailable: true };
    }
    throw error;
  }
}

export interface RenderedOrderDocument {
  pdf: Buffer;
  filename: string;
  documentCount: number;
  skipped: number;
}

/**
 * Service unique (route simple et lot). `orderIds` déjà validés ; un seul id
 * = document individuel (404/409 explicites), plusieurs = lot (commandes
 * absentes ou annulées écartées, ordre de la sélection conservé).
 */
export async function renderOrderDocuments(input: {
  db: ServiceClient;
  tenant: Tenant;
  kind: OrderDocumentKind;
  orderIds: string[];
  format: OrderDocumentFormat;
  settings: OrderDocumentsConfig;
  bulk: boolean;
  now?: Date;
}): Promise<RenderedOrderDocument> {
  const { db, tenant, kind, format, settings, bulk } = input;
  if (input.orderIds.length === 0) throw new OrderDocumentError(400, 'Aucune commande sélectionnée.');
  if (input.orderIds.length > MAX_BULK_ORDER_DOCUMENTS) {
    throw new OrderDocumentError(413, `Sélectionnez ${MAX_BULK_ORDER_DOCUMENTS} commandes au maximum.`);
  }
  if (kind === 'packing_slip' && !settings.packing_slip_enabled) {
    throw new OrderDocumentError(409, 'Le bon de colis est désactivé dans Paramètres › Documents des commandes.');
  }

  let loaded;
  try {
    loaded = await loadOrderDocumentData(db, { tenantId: tenant.id, orderIds: input.orderIds, mode: kind === 'picking_list' ? 'picking' : 'packing' });
  } catch (error) {
    if (error instanceof OrderDocumentDataError) throw new OrderDocumentError(503, 'Commandes momentanément illisibles. Réessayez.');
    throw error;
  }

  const printable = loaded.orders.filter(({ order }) => order.status !== 'cancelled');
  if (!bulk) {
    if (loaded.orders.length === 0) throw new OrderDocumentError(404, 'Commande introuvable.');
    if (printable.length === 0) throw new OrderDocumentError(409, 'Commande annulée : aucun document à imprimer.');
  } else if (printable.length === 0) {
    throw new OrderDocumentError(loaded.orders.length === 0 ? 404 : 409, loaded.orders.length === 0
      ? 'Aucune des commandes sélectionnées n’a été trouvée.'
      : 'Toutes les commandes sélectionnées sont annulées.');
  }

  const spec = ORDER_DOCUMENT_FORMATS[format];
  let html: string;
  let footerLabel: string;
  if (kind === 'picking_list') {
    const vms = printable.map(({ order, items, carton }) => buildPickingListViewModel({ order, items, tenant: { name: tenant.name }, carton, showDeliveryAddress: settings.picking_list_show_delivery_address }));
    html = pickingListHtml(vms, format);
    footerLabel = vms.length === 1 ? `#${vms[0]!.ref} · Liste de préparation` : `Listes de préparation · ${vms.length} commandes`;
  } else {
    const { qrs, unavailable } = settings.packing_slip_show_qr
      ? await packingSlipQrs(db, tenant, printable.map(({ order }) => order.id))
      : { qrs: new Map<string, PackingSlipQrVM>(), unavailable: false };
    const docTenant = documentTenant(tenant);
    const vms = printable.map(({ order, items }) => buildPackingSlipViewModel({
      order, items, tenant: docTenant, settings, qr: qrs.get(order.id) ?? null, qrUnavailable: unavailable,
    }));
    html = packingSlipHtml(vms, format);
    footerLabel = vms.length === 1 ? `Commande #${vms[0]!.ref}` : '';
  }

  let pdf: Buffer;
  try {
    pdf = await htmlToPdf(html, {
      paperWidthMm: spec.widthMm,
      paperHeightMm: spec.heightMm,
      marginsMm: spec.marginsMm,
      printBackground: true,
      footerHtml: documentFooterHtml(footerLabel),
      timeoutMs: GOTENBERG_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof GotenbergUnavailableError) {
      console.error('[order-documents] Gotenberg unavailable', tenant.id, error.message);
      throw new OrderDocumentError(503, 'Le service PDF est indisponible. Réessayez dans quelques instants.');
    }
    if (error instanceof GotenbergConversionError) {
      console.error('[order-documents] Gotenberg conversion failed', tenant.id, error.status);
      throw new OrderDocumentError(502, bulk ? 'Le PDF n’a pas pu être généré. Réduisez la sélection puis réessayez.' : 'Le PDF n’a pas pu être généré.');
    }
    throw error;
  }

  return {
    pdf,
    filename: orderDocumentFilename(kind, format, bulk ? { date: input.now ?? new Date() } : { orderId: printable[0]!.order.id }),
    documentCount: printable.length,
    skipped: input.orderIds.length - printable.length,
  };
}

/** Réponse PDF privée (données client) : jamais de cache partagé. */
export function pdfResponse(document: RenderedOrderDocument, download: boolean): NextResponse {
  return new NextResponse(new Uint8Array(document.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${document.filename}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Documents-Count': String(document.documentCount),
      'X-Documents-Skipped': String(document.skipped),
    },
  });
}

/**
 * Erreur en français. Le PDF est ouvert par navigation directe (nouvel onglet,
 * PWA) : on renvoie alors une page HTML lisible plutôt que du JSON brut.
 */
export function orderDocumentErrorResponse(error: unknown, request?: Request): NextResponse {
  const known = error instanceof OrderDocumentError;
  if (!known) console.error('[order-documents] unexpected error', error instanceof Error ? error.message : error);
  const status = known ? error.status : 500;
  const message = known ? error.message : 'Le document n’a pas pu être généré.';
  const headers = { 'Cache-Control': 'no-store' };
  if (request?.headers.get('accept')?.includes('text/html')) {
    return new NextResponse(orderDocumentErrorPage(message), { status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return NextResponse.json({ error: message }, { status, headers });
}

export function orderDocumentErrorPage(message: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Document indisponible</title>
<style>body{font-family:system-ui,sans-serif;background:#f9fafb;color:#111827;margin:0;padding:48px 16px}main{max-width:440px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:24px}h1{font-size:18px;margin:0 0 8px}p{color:#4b5563;line-height:1.5}a{display:inline-flex;min-height:44px;align-items:center;color:#111827;font-weight:600}</style></head>
<body><main><h1>Document indisponible</h1><p>${escapeHtml(message)}</p><a href="/admin">Retour aux commandes</a></main></body></html>`;
}
