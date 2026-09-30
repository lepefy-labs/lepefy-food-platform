import 'server-only';
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { gestionRpcError } from '@/lib/gestion/errors';

export type RpcResult<T> = { ok: true; row: T } | { ok: false; response: NextResponse };

/**
 * Chiama una RPC Gestion (RETURNS TABLE out_*) e restituisce la prima riga, o
 * una risposta HTTP con il messaggio francese corrispondente all'errore.
 */
export async function callGestionRpc<T>(fn: string, params: Record<string, unknown>): Promise<RpcResult<T>> {
  const { data, error } = await createServiceClient().rpc(fn, params);
  if (error) {
    const info = gestionRpcError(error);
    if (info.status >= 500) console.error(`[gestion] ${fn} failed:`, error.message);
    return { ok: false, response: NextResponse.json({ error: info.message, code: info.code }, { status: info.status }) };
  }
  const row = (Array.isArray(data) ? data[0] : data) as T | undefined;
  if (!row) {
    console.error(`[gestion] ${fn} returned no row`);
    return { ok: false, response: NextResponse.json({ error: 'Erreur inattendue. Réessayez.' }, { status: 500 }) };
  }
  return { ok: true, row };
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Le pagine Gestion sono force-dynamic; invalidare resta la regola per le route admin che scrivono. */
export function revalidateGestion(): void {
  revalidatePath('/admin/gestion', 'layout');
}
