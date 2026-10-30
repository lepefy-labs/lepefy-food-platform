import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { generateToken, hashToken, parseBearer, TOKEN_PREFIX } from '../ai/tokens';

export { generateToken, hashToken, TOKEN_PREFIX };

export const MACHINE_SCOPES = ['search', 'read', 'ask'] as const;
export type MachineScope = (typeof MACHINE_SCOPES)[number];


export interface MachineClient { clientId: string; repositoryId: string }

/**
 * Authenticates a machine request: bearer token only (no cookie, no tenant), scope checked, expiry
 * and revocation enforced by the RPC. Every failure is the same 401 so a probe learns nothing.
 */
export async function authenticateMachine(request: Request, scope: MachineScope): Promise<{ client: MachineClient } | { response: NextResponse }> {
  const deny = () => ({ response: NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer' } }) });
  const token = parseBearer(request.headers.get('authorization'));
  if (!token) return deny();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (createServiceClient() as any).rpc('engineering_authenticate_client', { p_token_hash: hashToken(token), p_scope: scope });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row?.out_client_id) return deny();
    return { client: { clientId: row.out_client_id, repositoryId: row.out_repository_id } };
  } catch {
    return deny();
  }
}
