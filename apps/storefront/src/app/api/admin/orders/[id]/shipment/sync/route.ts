import { NextRequest } from 'next/server';
import { handleAdminShipment } from '@/lib/shipping/adminShipmentRoute';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return handleAdminShipment(request, params.id, 'sync');
}
