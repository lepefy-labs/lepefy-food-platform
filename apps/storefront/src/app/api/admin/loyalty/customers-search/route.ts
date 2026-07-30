import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

interface CustomerSearchRow {
  id: string;
  email: string;
  full_name: string | null;
  referral_access_granted: boolean;
  referral_access_reason: string | null;
  referral_suspended: boolean;
}

// Endpoint aggiunto (non nella spec) — necessario per la sezione admin
// "Ricerca customer + bottone Accorder l'accès parrainage" della sezione D.
// Query param sanificato (solo alfanumerico/spazio/@/-/.) prima di finire nel
// filtro, per evitare che un carattere come virgola o parentesi lo alteri.
//
// STORIA DEL FIX — 500 su ricerca per email:
// v1 usava .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`) — valore NON
// quotato passato al filtro raw .or(). Causa verificata: la grammar
// ufficiale PostgREST (docs/references/api/url_grammar.rst, sezione
// "Reserved characters") impone che i caratteri riservati , . : * ( ) dentro
// un valore di filtro or()/and() siano racchiusi tra doppi apici — un'email
// contiene sempre un punto (es. "gmail.com"), il parser PostgREST falliva.
// v2 aveva quotato il valore (`email.ilike."%${q}%"`) — costruzione dell'URL
// verificata corretta con @supabase/supabase-js reale contro la grammar
// documentata, ma l'utente riporta ancora 500 dopo il deploy di v2: non
// avendo accesso ai log Vercel né a un'istanza PostgREST live in questo
// ambiente per riprodurre l'esatta interazione quotatura+wildcard, non posso
// escludere con certezza un'altra sottigliezza della grammar raw .or().
//
// v3 (questa versione) elimina il problema alla radice invece di continuare
// ad affinare la sintassi manuale: usa SOLO .ilike(), lo stesso builder
// tipizzato già usato con successo altrove nel progetto per una ricerca
// equivalente (lib/catalog/pagination.ts) — supabase-js gestisce lì
// internamente tutto l'escaping/quoting necessario, senza che l'applicazione
// debba costruire a mano una stringa in sintassi filtro PostgREST. Due
// query .ilike() indipendenti (email, full_name) eseguite in parallelo e
// unite lato applicativo, deduplicate per id — niente più .or() raw, quindi
// nessuna classe di bug legata a come si quota/scappa un valore per quella
// sintassi, qualunque essa sia.
export async function GET(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const raw = req.nextUrl.searchParams.get('q') ?? '';
  const q = raw.trim().replace(/[^a-zA-Z0-9À-ÿ@._\- ]/g, '').slice(0, 60);

  if (q.length < 2) {
    return NextResponse.json({ customers: [] });
  }

  const supabase = createServiceClient();
  const columns = 'id, email, full_name, referral_access_granted, referral_access_reason, referral_suspended';

  const [byEmail, byName] = await Promise.all([
    supabase
      .from('customers')
      .select(columns)
      .eq('tenant_id', tenant.id)
      .ilike('email', `%${q}%`)
      .limit(20),
    supabase
      .from('customers')
      .select(columns)
      .eq('tenant_id', tenant.id)
      .ilike('full_name', `%${q}%`)
      .limit(20),
  ]);

  if (byEmail.error) {
    return NextResponse.json({ error: byEmail.error.message }, { status: 500 });
  }
  if (byName.error) {
    return NextResponse.json({ error: byName.error.message }, { status: 500 });
  }

  const merged = new Map<string, CustomerSearchRow>();
  for (const row of [...(byEmail.data ?? []), ...(byName.data ?? [])] as CustomerSearchRow[]) {
    merged.set(row.id, row);
  }

  return NextResponse.json({ customers: [...merged.values()].slice(0, 20) });
}
