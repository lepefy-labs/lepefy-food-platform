import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { listEntityDocuments, parseEntityType, uploadEntityDocument } from '@/lib/gestion/documents';
import { revalidateGestion } from '@/lib/gestion/rpc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

type Params = { params: { entityType: string; entityId: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const entityType = parseEntityType(params.entityType);
  if (!entityType) return NextResponse.json({ error: 'Type invalide.' }, { status: 400 });
  return listEntityDocuments(gate.tenant.id, entityType, params.entityId);
}

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const entityType = parseEntityType(params.entityType);
  if (!entityType) return NextResponse.json({ error: 'Type invalide.' }, { status: 400 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Formulaire invalide.' }, { status: 400 });
  const response = await uploadEntityDocument(gate.tenant.id, entityType, params.entityId, gate.actorId, form);
  if (response.ok) revalidateGestion();
  return response;
}
