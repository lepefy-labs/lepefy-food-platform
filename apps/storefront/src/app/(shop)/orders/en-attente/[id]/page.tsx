import { redirect, notFound } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { PendingSessionDetailClient } from './PendingSessionDetailClient';

// Session obligatoire — même garde que /compte/parrainage et
// /compte/carte-fidelite (getSessionCustomer via cookies(), page dynamique
// de toute façon). checkout_sessions est mutable (status peut passer à
// 'cancelled' entre deux requêtes) : force-dynamic seul ne suffit pas
// (bug Next.js 14.2.x, cf. règle permanente).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface PageProps {
  params: { id: string };
}

export default async function PendingSessionDetailPage({ params }: PageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant      = await getTenant(tenantSlug);
  const customer    = await getSessionCustomer(tenant.id);

  // Aucun mécanisme de "return url" n'existe dans ce repo (vérifié : ni
  // /compte/connexion/page.tsx ni ConnexionClient.tsx ne lisent de
  // searchParams — le login redirige toujours vers /compte en dur). Même
  // garde minimale que /compte/parrainage et /compte/carte-fidelite plutôt
  // que d'inventer un paramètre ignoré par la page cible.
  if (!customer) redirect('/compte/connexion');

  const supabase = createServiceClient();

  // Vérification d'appartenance AVANT tout rendu — ne jamais laisser
  // deviner à un client connecté qu'une session appartenant à quelqu'un
  // d'autre existe (404 uniforme, pas de 403 qui confirmerait l'existence).
  const { data: session } = await supabase
    .from('checkout_sessions')
    .select('id, customer_id, status')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!session || session.customer_id !== customer.id || session.status !== 'open') {
    notFound();
  }

  const allMethods = await getTenantPaymentMethods(tenant.id);
  const externalPaymentMethods = allMethods.filter(
    (m) => m.method !== 'bank_transfer' && m.method !== 'cash' && !!m.extra?.link
      && m.enabled_modules.includes('shop'),
  );

  return (
    <PendingSessionDetailClient
      tenant={tenant}
      externalPaymentMethods={externalPaymentMethods}
      sessionId={params.id}
    />
  );
}
