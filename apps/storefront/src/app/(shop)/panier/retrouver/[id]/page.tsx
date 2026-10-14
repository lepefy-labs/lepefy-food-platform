import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { PRODUCT_CARD_SELECT } from '@/lib/catalog/productCardSelect';
import { isValidCartComebackToken, isWithinComebackWindow, rebuildCartLines, type ComebackSessionItem } from '@/lib/checkout/cartComeback';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';
import CartComebackClient from './CartComebackClient';

// Lien signé d'une relance de panier carte expiré : liste des articles à prix
// et stock du jour, jamais les coordonnées ni le paiement. Jamais indexé.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Votre panier vous attend', robots: { index: false, follow: false } };

interface ComebackSession {
  id: string;
  email: string | null;
  status: string;
  created_at: string;
  order_id: string | null;
  items: ComebackSessionItem[] | null;
}

function Unavailable({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <h1 className="font-display text-2xl font-bold text-gray-950">{title}</h1>
      <p className="text-gray-700">{text}</p>
      <Link href="/" className="mt-2 inline-flex min-h-12 items-center rounded-2xl px-6 font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
        Voir le catalogue
      </Link>
    </div>
  );
}

export default async function CartComebackPage({ params, searchParams }: { params: { id: string }; searchParams?: { token?: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const supabase = createServiceClient();
  const { data } = await supabase.from('checkout_sessions')
    .select('id, email, status, created_at, order_id, items')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('origin', 'storefront')
    .maybeSingle();
  const session = data as ComebackSession | null;
  if (!session?.email || !isValidCartComebackToken(session.id, session.email, searchParams?.token)) notFound();

  if (session.order_id || session.status === 'completed') {
    return <Unavailable title="Commande déjà passée" text="Ce panier a déjà été commandé. Merci pour votre confiance !" />;
  }
  if (session.status === 'cancelled' || !isWithinComebackWindow(session.created_at)) {
    return <Unavailable title="Ce lien n’est plus valable" text="Votre sélection n’est plus disponible, mais tout le catalogue vous attend." />;
  }

  const items = Array.isArray(session.items) ? session.items : [];
  const ids = [...new Set(items.map((item) => item.productId).filter((id): id is string => Boolean(id)))];
  const { data: products } = ids.length
    ? await supabase.from('products').select(PRODUCT_CARD_SELECT).eq('tenant_id', tenant.id).eq('active', true).in('id', ids)
    : { data: [] };
  const lines = rebuildCartLines(items, ((products ?? []) as unknown as Array<ProductCardProduct & { stock: number | null }>));

  return <CartComebackClient sessionId={session.id} lines={lines} currency={tenant.currency} />;
}
