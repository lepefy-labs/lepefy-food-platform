import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireEngineeringApi } from '@/lib/engineering/server/guard';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DELETE revokes (never deletes the row: the audit trail of who had access stays). */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const denied = await requireEngineeringApi('engineering.admin');
  if (denied) return denied;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createServiceClient() as any).from('engineering_api_clients')
    .update({ revoked_at: new Date().toISOString() }).eq('id', params.id).is('revoked_at', null).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: 'Revocation failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  if (!data) return NextResponse.json({ error: 'Not found or already revoked' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ revoked: true }, { headers: { 'Cache-Control': 'no-store' } });
}
