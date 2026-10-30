import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { currentOwnerId, requireEngineeringApi } from '@/lib/engineering/server/guard';
import { ENGINEERING_REPOSITORY } from '@/lib/engineering/server/activeRun';
import { MACHINE_SCOPES, generateToken, type MachineScope } from '@/lib/engineering/server/machineAuth';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => createServiceClient() as any;

/** Machine credentials, never including a token or its hash. */
export async function GET() {
  const denied = await requireEngineeringApi('engineering.admin');
  if (denied) return denied;
  const { data, error } = await db().from('engineering_api_clients')
    .select('id, name, token_prefix, scopes, expires_at, revoked_at, last_used_at, created_at').order('created_at', { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: 'Clients unavailable (migration 176?)' }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ clients: data ?? [] }, { headers: NO_STORE });
}

/**
 * POST { name, scopes, days } — creates a credential. The token is returned ONCE in this response
 * and cannot be recovered: only its SHA-256 is stored.
 */
export async function POST(request: Request) {
  const denied = await requireEngineeringApi('engineering.admin');
  if (denied) return denied;
  let body: { name?: unknown; scopes?: unknown; days?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE }); }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const scopes = Array.isArray(body.scopes) ? [...new Set(body.scopes.filter((scope): scope is MachineScope => (MACHINE_SCOPES as readonly string[]).includes(scope as string)))] : [];
  const days = Number.isInteger(body.days) ? (body.days as number) : 30;
  if (name.length < 2 || name.length > 80) return NextResponse.json({ error: 'Invalid name' }, { status: 400, headers: NO_STORE });
  if (scopes.length === 0) return NextResponse.json({ error: 'At least one scope is required' }, { status: 400, headers: NO_STORE });
  if (days < 1 || days > 365) return NextResponse.json({ error: 'Lifetime must be 1-365 days' }, { status: 400, headers: NO_STORE });

  const { data: repo } = await db().from('engineering_repositories').select('id').eq('slug', ENGINEERING_REPOSITORY).maybeSingle();
  if (!repo) return NextResponse.json({ error: 'Repository unavailable' }, { status: 503, headers: NO_STORE });

  const { token, hash, prefix } = generateToken();
  const { data, error } = await db().from('engineering_api_clients').insert({
    repository_id: repo.id, name, token_hash: hash, token_prefix: prefix, scopes,
    expires_at: new Date(Date.now() + days * 86_400_000).toISOString(), created_by: await currentOwnerId(),
  }).select('id, name, token_prefix, scopes, expires_at').single();
  if (error || !data) return NextResponse.json({ error: 'Creation failed' }, { status: 500, headers: NO_STORE });
  return NextResponse.json({ client: data, token }, { status: 201, headers: NO_STORE });
}
