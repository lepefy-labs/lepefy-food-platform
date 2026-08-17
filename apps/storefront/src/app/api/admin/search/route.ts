import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { formatPrice } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

type Scope = 'orders' | 'products' | 'events' | 'customers';
const ALL_SCOPES: Scope[] = ['orders', 'products', 'events', 'customers'];

interface SearchResultItem {
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
}

// Même approche que customers-search/route.ts (v3, voir son commentaire) :
// query param nettoyé, puis .ilike() typé — jamais de filtre .or() en
// syntaxe brute PostgREST, déjà source d'un bug 500 en production ailleurs.
function sanitizeQuery(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9À-ÿ@._\- ]/g, '').slice(0, 60);
}

export async function GET(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const q = sanitizeQuery(req.nextUrl.searchParams.get('q') ?? '');

  const scopeParam = req.nextUrl.searchParams.get('scope');
  const requestedScopes = scopeParam
    ? scopeParam.split(',').filter((s): s is Scope => ALL_SCOPES.includes(s as Scope))
    : ALL_SCOPES;
  const scopes = requestedScopes.length > 0 ? requestedScopes : ALL_SCOPES;

  const empty: Record<Scope, SearchResultItem[]> = { orders: [], products: [], events: [], customers: [] };

  if (q.length < 2) {
    return NextResponse.json({ query: q, results: empty });
  }

  const supabase = createServiceClient();
  const like = `%${q}%`;
  const LIMIT = 5;

  const results: Record<Scope, SearchResultItem[]> = { ...empty };

  await Promise.all([
    // ── Commandes — nom/email uniquement (pas de recherche sur l'id : c'est
    // une colonne uuid, ILIKE dessus n'est pas garanti côté PostgREST/Postgres
    // sans cast explicite — non tenté ici, cf. rapport de fin de cycle). ──────
    scopes.includes('orders')
      ? (async () => {
          const [byName, byEmail] = await Promise.all([
            supabase
              .from('orders')
              .select('id, full_name, email, total, created_at')
              .eq('tenant_id', tenant.id)
              .ilike('full_name', like)
              .order('created_at', { ascending: false })
              .limit(LIMIT),
            supabase
              .from('orders')
              .select('id, full_name, email, total, created_at')
              .eq('tenant_id', tenant.id)
              .ilike('email', like)
              .order('created_at', { ascending: false })
              .limit(LIMIT),
          ]);
          type OrderRow = { id: string; full_name: string | null; email: string; total: number; created_at: string };
          const merged = new Map<string, OrderRow>();
          for (const row of [...(byName.data ?? []), ...(byEmail.data ?? [])] as OrderRow[]) {
            merged.set(row.id, row);
          }
          results.orders = [...merged.values()].slice(0, LIMIT).map(o => ({
            id: o.id,
            label: `#${o.id.slice(0, 8).toUpperCase()} — ${o.full_name ?? o.email}`,
            sublabel: formatPrice(o.total, tenant.currency),
            href: `/admin/orders/${o.id}`,
          }));
        })()
      : Promise.resolve(),

    // ── Produits ──────────────────────────────────────────────────────────
    scopes.includes('products')
      ? (async () => {
          const { data } = await supabase
            .from('products')
            .select('id, name, price')
            .eq('tenant_id', tenant.id)
            .ilike('name', like)
            .order('name', { ascending: true })
            .limit(LIMIT);
          results.products = (data ?? []).map(p => ({
            id: p.id,
            label: p.name,
            sublabel: formatPrice(p.price, tenant.currency),
            href: `/admin/catalogue/${p.id}`,
          }));
        })()
      : Promise.resolve(),

    // ── Événements ────────────────────────────────────────────────────────
    scopes.includes('events')
      ? (async () => {
          const { data } = await supabase
            .from('events')
            .select('id, title, date_start')
            .eq('tenant_id', tenant.id)
            .ilike('title', like)
            .order('date_start', { ascending: false })
            .limit(LIMIT);
          results.events = (data ?? []).map(e => ({
            id: e.id,
            label: e.title,
            sublabel: new Date(e.date_start).toLocaleDateString('fr-FR'),
            href: `/admin/evenementiel/evenements/${e.id}`,
          }));
        })()
      : Promise.resolve(),

    // ── Clients — table `customers` existe déjà (voir rapport, corrige une
    // hypothèse du prompt). Pas de page de détail admin dédiée aujourd'hui :
    // le lien pointe sur un `mailto:`, seule action réelle disponible. ──────
    scopes.includes('customers')
      ? (async () => {
          const [byName, byEmail] = await Promise.all([
            supabase
              .from('customers')
              .select('id, full_name, email, phone')
              .eq('tenant_id', tenant.id)
              .ilike('full_name', like)
              .limit(LIMIT),
            supabase
              .from('customers')
              .select('id, full_name, email, phone')
              .eq('tenant_id', tenant.id)
              .ilike('email', like)
              .limit(LIMIT),
          ]);
          type CustomerRow = { id: string; full_name: string | null; email: string; phone: string | null };
          const merged = new Map<string, CustomerRow>();
          for (const row of [...(byName.data ?? []), ...(byEmail.data ?? [])] as CustomerRow[]) {
            merged.set(row.id, row);
          }
          results.customers = [...merged.values()].slice(0, LIMIT).map(c => ({
            id: c.id,
            label: c.full_name ?? c.email,
            sublabel: c.full_name ? c.email : c.phone,
            href: `mailto:${c.email}`,
          }));
        })()
      : Promise.resolve(),
  ]);

  return NextResponse.json({ query: q, results });
}
