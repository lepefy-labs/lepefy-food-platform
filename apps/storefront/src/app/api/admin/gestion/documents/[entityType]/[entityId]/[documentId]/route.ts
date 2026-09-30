import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { deleteEntityDocument, downloadEntityDocument, parseEntityType } from '@/lib/gestion/documents';
import { revalidateGestion } from '@/lib/gestion/rpc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

type Params = { params: { entityType: string; entityId: string; documentId: string } };

// Lecture via le backend autorisé uniquement (bucket privé, aucune URL publique).
export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const entityType = parseEntityType(params.entityType);
  if (!entityType) return NextResponse.json({ error: 'Type invalide.' }, { status: 400 });
  return downloadEntityDocument(gate.tenant.id, entityType, params.entityId, params.documentId);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const entityType = parseEntityType(params.entityType);
  if (!entityType) return NextResponse.json({ error: 'Type invalide.' }, { status: 400 });
  const response = await deleteEntityDocument(gate.tenant.id, entityType, params.entityId, params.documentId, gate.actorId);
  if (response.ok) revalidateGestion();
  return response;
}
