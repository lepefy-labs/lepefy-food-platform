import { NextRequest, NextResponse } from 'next/server';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { getAdminWorkspaceUrls } from '@/lib/admin/workspace';
import { GESTION_VIEW_PERMISSIONS, gestionToday } from '@/lib/gestion/domain';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { EXPORT_TYPES, ExportTooLargeError, loadGestionExport, type GestionExportType } from '@/lib/gestion/exportData';
import { buildGestionWorkbook, exportFileName } from '@/lib/gestion/exportWorkbook';
import { parseExportPeriod } from '@/lib/gestion/exportPeriod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: { type: string } }) {
  if (!(EXPORT_TYPES as readonly string[]).includes(params.type)) {
    return NextResponse.json({ error: 'Type d’export invalide.' }, { status: 400 });
  }
  const type = params.type as GestionExportType;
  const period = parseExportPeriod(request.nextUrl.searchParams);
  if (!period) return NextResponse.json({ error: 'Période invalide.' }, { status: 400 });
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const access = await getCurrentAdminAccessContext(gate.tenant.id);
  if (!access || (!access.isPlatformOwner && access.tenantId !== gate.tenant.id)) {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  }
  if (type === 'full' && !GESTION_VIEW_PERMISSIONS.every((permission) => canAdmin(access, permission))) {
    return NextResponse.json({ error: 'Toutes les permissions de lecture Gestion sont requises.' }, { status: 403 });
  }
  const origin = getAdminWorkspaceUrls(gate.tenant).shopBaseUrl;
  if (!origin) return NextResponse.json({ error: 'URL de la boutique indisponible.' }, { status: 503 });

  try {
    const generatedAt = new Date();
    const includeTreasuryInPurchases = canAdmin(access, 'treasury.view');
    const data = await loadGestionExport(gate.tenant.id, type, period, includeTreasuryInPurchases);
    const workbook = await buildGestionWorkbook(data, {
      type, tenantName: gate.tenant.name, tenantCurrency: gate.tenant.currency, origin, period, generatedAt, includeTreasuryInPurchases,
    });
    const content = await workbook.xlsx.writeBuffer();
    const filename = exportFileName(type, gate.tenant.slug, gestionToday(generatedAt));
    return new NextResponse(new Uint8Array(content), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ExportTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    console.error('Gestion Excel export failed', error);
    return NextResponse.json({ error: 'Export Excel indisponible.' }, { status: 500 });
  }
}
