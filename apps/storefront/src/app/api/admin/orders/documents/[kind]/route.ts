import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/adminRbac';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveRequestedFormat } from '@/lib/orders/documents/formats';
import { readOrderDocumentSettings } from '@/lib/orders/documents/settings';
import {
  OrderDocumentError, orderDocumentErrorResponse, ORDER_DOCUMENT_ROUTE_KINDS, parseOrderIdList, pdfResponse, renderOrderDocuments,
} from '@/lib/orders/documents/renderOrderDocuments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 30;

/**
 * GET /api/admin/orders/documents/[kind]?ids=a,b,c&format=a5|a4&download=1
 * Un seul PDF pour la sélection, une commande par nouvelle page, dans l'ordre
 * des `ids` (celui de la liste). Commandes d'un autre tenant ou annulées
 * écartées ; au-delà de MAX_BULK_ORDER_DOCUMENTS → 413.
 */
export async function GET(request: NextRequest, { params }: { params: { kind: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, 'orders.view');
  if (denied) return denied;

  try {
    const kind = ORDER_DOCUMENT_ROUTE_KINDS[params.kind];
    if (!kind) throw new OrderDocumentError(404, 'Document inconnu.');
    const orderIds = parseOrderIdList(request.nextUrl.searchParams.get('ids'));
    const db = createServiceClient();
    const settings = await readOrderDocumentSettings(db, tenant.id);
    const fallback = kind === 'picking_list' ? settings.config.picking_list_format : settings.config.packing_slip_format;
    const format = resolveRequestedFormat(request.nextUrl.searchParams.get('format'), fallback);
    if (!format) throw new OrderDocumentError(400, 'Format invalide : choisissez A5 ou A4.');
    const document = await renderOrderDocuments({ db, tenant, kind, orderIds, format, settings: settings.config, bulk: true });
    return pdfResponse(document, request.nextUrl.searchParams.get('download') === '1');
  } catch (error) {
    return orderDocumentErrorResponse(error, request);
  }
}
