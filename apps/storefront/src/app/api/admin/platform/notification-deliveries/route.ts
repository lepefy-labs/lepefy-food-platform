import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { DELIVERY_LIST, DELIVERY_TYPE_LABELS, loadDeliveryExport, loadDeliveryHistory } from '@/lib/notifications/deliveryHistory';
import { resolvePlatformTenantId } from '@/lib/notifications/platformTenant';
import { NOTIFICATION_DELIVERY_STATUS_META, statusMeta } from '@/lib/admin/statusRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  // Neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Notification deliveries of a tenant, platform owner only: transport,
 * provider message ids and raw errors are support data and are never exposed
 * to tenants. Payloads are never returned. Same URL filters as the
 * « Historique » page; `format=csv` exports up to 2 000 rows.
 */
export async function GET(req: NextRequest) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  const values = DELIVERY_LIST.parse(req.nextUrl.searchParams);
  const tenantId = await resolvePlatformTenantId(values.tenant);
  if (!tenantId) return NextResponse.json({ error: 'Boutique introuvable.' }, { status: 404 });
  const db = createServiceClient();
  try {
    if (req.nextUrl.searchParams.get('format') === 'csv') {
      const rows = await loadDeliveryExport(db, tenantId, values);
      const header = ['date', 'statut', 'canal', 'type', 'objet', 'destinataires', 'essais', 'transport', 'id_message', 'statut_fournisseur', 'erreur'];
      const lines = rows.map((row) => [
        row.created_at, statusMeta(NOTIFICATION_DELIVERY_STATUS_META, row.status).label, row.channel, DELIVERY_TYPE_LABELS[row.notification_type] ?? row.notification_type,
        row.subject, row.recipients.join(' '), `${row.attempts}/${row.max_attempts}`, row.transport, row.provider_message_id, row.provider_status, row.last_error,
      ].map(csvCell).join(';'));
      return new NextResponse(`﻿${[header.join(';'), ...lines].join('\n')}`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="envois-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    const { rows, window } = await loadDeliveryHistory(db, tenantId, values);
    return NextResponse.json({ available: true, deliveries: rows, total: window.total, page: window.page, pageSize: window.pageSize });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    // Migration 136/158 not applied yet: the history is simply unavailable.
    if (code === '42P01' || code === 'PGRST205' || code === '42703' || code === 'PGRST200') return NextResponse.json({ available: false, deliveries: [] });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur' }, { status: 500 });
  }
}
