import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { applyItem } from '@/lib/externalCatalog/server/repository';
import { guardPlatformOwner, invalid, respond } from '@/lib/externalCatalog/server/routeGuard';
import { applyItemSchema, toRpcFields } from '@/lib/externalCatalog/server/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Applique les champs cochés d'un produit WhatsApp à un produit du tenant cible
 * (création inactive ou mise à jour). Idempotent par `requestKey`.
 */
export async function POST(req: NextRequest, { params }: { params: { itemId: string } }) {
  const guard = await guardPlatformOwner(req, true);
  if (guard instanceof NextResponse) return guard;
  if (!z.string().uuid().safeParse(params.itemId).success) return invalid();
  const parsed = applyItemSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => i.message);
    if (messages.includes('name_and_price_required')) return invalid('Le nom et le prix unitaire sont obligatoires pour créer le produit.');
    if (messages.includes('product_required')) return invalid('Choisissez le produit Lepefy à mettre à jour.');
    if (messages.includes('nothing_to_apply')) return invalid('Cochez au moins un champ à appliquer.');
    return invalid('Valeurs invalides : vérifiez le prix (2 décimales), le minimum et l’incrément (entiers ≥ 1).');
  }
  const body = parsed.data;
  return respond(await applyItem(params.itemId, {
    mode: body.mode,
    productId: body.productId,
    fields: toRpcFields(body.fields),
    images: body.images,
    requestKey: body.requestKey,
  }, guard.actor));
}
