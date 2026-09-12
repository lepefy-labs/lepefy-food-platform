import { NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase/server';
import { deleteCustomerAccount } from '@/lib/privacy/deleteCustomerAccount';

export async function POST() {
  const { supabase, applyCookies } = createRouteClient();

  try {
    const result = await deleteCustomerAccount(supabase);
    const status =
      result.status === 'completed' || result.status === 'manual_review'
        ? 200
        : result.reason === 'unauthenticated'
          ? 401
          : result.reason === 'customer_not_found'
            ? 403
            : 500;

    return applyCookies(NextResponse.json({ status: result.status }, { status }));
  } catch {
    console.error('[privacy/account-deletion] deletion failed');
    return applyCookies(NextResponse.json({ status: 'failed' }, { status: 500 }));
  }
}
