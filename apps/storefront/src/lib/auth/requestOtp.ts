import { createClient } from '@/lib/supabase/server';

export async function requestOtp(email: string): Promise<{ sent: boolean; error?: string }> {
  const supabase = createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  if (error) {
    console.error('[auth] requestOtp error:', error.message);
    return { sent: false, error: error.message };
  }

  return { sent: true };
}
