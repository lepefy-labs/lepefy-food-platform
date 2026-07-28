import { NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase/server';

export async function POST() {
  const { supabase, applyCookies } = createRouteClient();
  await supabase.auth.signOut();
  return applyCookies(NextResponse.json({ ok: true }));
}
