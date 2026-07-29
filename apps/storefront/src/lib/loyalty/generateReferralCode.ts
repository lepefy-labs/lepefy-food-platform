import { createServiceClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/utils/format';

const SUFFIX_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans caractères ambigus (0/O, 1/I/L)

function randomSuffix(length = 4): string {
  return Array.from({ length }, () => SUFFIX_CHARS[Math.floor(Math.random() * SUFFIX_CHARS.length)]).join('');
}

function codeBase(fullName: string | null, email: string): string {
  const source = fullName?.trim() || email.split('@')[0] || email;
  const slug = slugify(source).replace(/-/g, '').slice(0, 8).toUpperCase();
  return slug || 'AMI';
}

/**
 * Genera (o riusa se già presente) il referral_codes.code del customer.
 * Formato leggibile: base derivata dal nome/email + 4 caratteri random,
 * es. "MARIE-7XQ2" — riprova con un nuovo suffisso in caso di collisione
 * sull'unique index (tenant_id, code).
 */
export async function generateReferralCode(params: {
  tenantId: string;
  customerId: string;
  fullName: string | null;
  email: string;
}): Promise<string> {
  const { tenantId, customerId, fullName, email } = params;
  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from('referral_codes')
    .select('code')
    .eq('tenant_id', tenantId)
    .eq('owner_customer_id', customerId)
    .maybeSingle();

  if (existing) return existing.code;

  const base = codeBase(fullName, email);

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${base}-${randomSuffix()}`;
    const { error } = await supabase.from('referral_codes').insert({
      tenant_id: tenantId,
      owner_customer_id: customerId,
      code,
    });
    if (!error) return code;
    if (error.code !== '23505') throw error; // autre chose qu'une collision d'unicité
  }

  throw new Error('Impossible de générer un code de parrainage unique.');
}
