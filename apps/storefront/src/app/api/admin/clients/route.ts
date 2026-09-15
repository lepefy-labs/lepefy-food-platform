import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCustomers } from '@/lib/admin/crm';
import { resolveOrCreateCustomer } from '@/lib/customers/resolveOrCreateCustomer';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const createSchema = z.object({
  fullName: z.string().trim().max(160).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
}).refine((value) => value.fullName || value.email || value.phone, 'Un nom, un e-mail ou un téléphone est requis.');

async function tenant() { return getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'); }

export async function GET(req: NextRequest) {
  const currentTenant = await tenant();
  const denied = await requireAdmin(currentTenant.id); if (denied) return denied;
  const p = req.nextUrl.searchParams;
  const result = await getCustomers(currentTenant.id, {
    q: p.get('q') ?? undefined, segment: p.get('segment') ?? undefined, source: p.get('source') ?? undefined,
    marketing: p.has('marketing') ? p.get('marketing') === 'true' : undefined,
    loyalty: p.has('loyalty') ? p.get('loyalty') === 'true' : undefined,
    minOrders: p.has('minOrders') ? Number(p.get('minOrders')) : undefined,
    maxOrders: p.has('maxOrders') ? Number(p.get('maxOrders')) : undefined,
    minLifetimeValue: p.has('minLifetimeValue') ? Number(p.get('minLifetimeValue')) : undefined,
    createdAfter: p.get('createdAfter') ?? undefined, createdBefore: p.get('createdBefore') ?? undefined,
    lastPurchaseBefore: p.get('lastPurchaseBefore') ?? undefined, tagId: p.get('tagId') ?? undefined,
    page: Number(p.get('page') ?? 1), sort: (p.get('sort') as any) ?? undefined, direction: p.get('direction') === 'asc' ? 'asc' : 'desc',
  });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const currentTenant = await tenant();
  const denied = await requireAdmin(currentTenant.id); if (denied) return denied;
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Données invalides.' }, { status: 400 });
  try {
    const customer = await resolveOrCreateCustomer({
      tenantId: currentTenant.id, fullName: parsed.data.fullName, email: parsed.data.email,
      phone: parsed.data.phone, source: 'admin',
    });
    if (!customer.created) return NextResponse.json({ error: 'Un client avec ces coordonnées existe déjà.', customerId: customer.id }, { status: 409 });
    return NextResponse.json({ customerId: customer.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Création impossible.' }, { status: 409 });
  }
}
