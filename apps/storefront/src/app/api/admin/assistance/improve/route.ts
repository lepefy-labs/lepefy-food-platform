import { NextResponse } from 'next/server';
import { readJsonBody, supportTenantApi } from '@/lib/support/server/access';
import { improveSupportMessage, isImproveAvailable } from '@/lib/support/server/improve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/** Is « Améliorer mon message » offered? (AI route configured and its key present) */
export async function GET() {
  const guard = await supportTenantApi({ write: false });
  if (!guard.ok) return guard.response;
  return NextResponse.json({ available: await isImproveAvailable() }, { headers: { 'Cache-Control': 'private, max-age=300' } });
}

/** A reworded suggestion; nothing is sent, the admin keeps the choice. */
export async function POST(request: Request) {
  const guard = await supportTenantApi({ write: true });
  if (!guard.ok) return guard.response;
  const body = await readJsonBody(request, 12_000);
  if (!body || typeof body.text !== 'string') return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  const result = await improveSupportMessage(guard.tenant.id, body.text);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ text: result.text });
}
