import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessManagementApi } from '@/lib/gestion/featureGate';
import { searchProducts } from '@/lib/gestion/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Recherche catalogue pour lier une ligne d'achat à un produit existant (jamais de création de produit).
export async function GET(req: NextRequest) {
  const gate = await requireBusinessManagementApi();
  if (!gate.ok) return gate.response;
  const products = await searchProducts(gate.tenant.id, req.nextUrl.searchParams.get('q') ?? '');
  return NextResponse.json({ products });
}
