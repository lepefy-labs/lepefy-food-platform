import { createServiceClient } from '@/lib/supabase/server';

export class InsufficientPointsError extends Error {
  constructor() {
    super('Solde de points insuffisant.');
    this.name = 'InsufficientPointsError';
  }
}

export async function redeemPoints(params: {
  tenantId: string;
  customerId: string;
  pointsToRedeem: number;
  orderId?: string;
}): Promise<{ ledgerEntryId: string }> {
  const { tenantId, customerId, pointsToRedeem, orderId } = params;
  const supabase = createServiceClient();

  const { data: balance } = await supabase
    .from('customer_points_balance')
    .select('confirmed_balance')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .maybeSingle();

  const confirmedBalance = balance?.confirmed_balance ?? 0;
  if (confirmedBalance < pointsToRedeem) throw new InsufficientPointsError();

  const { data, error } = await supabase
    .from('points_ledger')
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      amount: -pointsToRedeem,
      status: 'CONFIRMED',
      transaction_type: 'REDEEMED',
      reference_order_id: orderId ?? null,
    })
    .select('id')
    .single();

  if (error || !data) throw error ?? new Error('Erreur lors de la création de la ligne de ledger.');

  return { ledgerEntryId: data.id };
}
