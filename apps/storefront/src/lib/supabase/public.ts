// Client Supabase SENZA cookies() — usare SOLO per letture pubbliche non
// personalizzate (tenant, categorie, prodotti attivi). MAI per dati legati
// a un utente/sessione autenticata: in quel caso usare createClient() da
// './server.ts'. Vedi AUDIT_PERFORMANCE_FRONTEND.md §3.2.

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}
