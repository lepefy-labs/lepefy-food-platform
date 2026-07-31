import { createServiceClient } from '@/lib/supabase/server';

interface ShippingAddressPayload {
  full_name:   string;
  line1:       string;
  line2?:      string | null;
  city:        string;
  postal_code: string;
  country:     string;
}

interface SaveCheckoutProfileParams {
  customerId:      string;
  tenantId:        string;
  fullName?:       string | null;
  phone?:          string | null;
  shippingAddress: ShippingAddressPayload | null;
}

const clean = (v: string | null | undefined): string | null => {
  const trimmed = (v ?? '').trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * Memorizza sul profilo del cliente i dati inseriti al checkout, per
 * pre-compilare gli ordini successivi.
 *
 * NON LANCIA MAI: ogni errore viene loggato e ingoiato. Stesso principio già
 * applicato all'hook loyalty in /api/admin/orders/[id] — il cliente ha appena
 * pagato (o sta per farlo), la comodità della pre-compilazione futura non può
 * in nessun caso far fallire l'ordine.
 *
 * - `customers.full_name` / `phone` sono aggiornati solo se il form ha inviato
 *   un valore non vuoto E diverso da quello già salvato: nessuna scrittura
 *   inutile, e un campo lasciato vuoto non sovrascrive mai con null un dato
 *   che il profilo aveva già.
 * - L'indirizzo viene registrato come unico default via
 *   `upsert_default_address` (atomica lato Postgres). Assente per gli ordini
 *   pickup, dove `shippingAddress` è null e questo passo viene saltato.
 */
export async function saveCheckoutProfile({
  customerId,
  tenantId,
  fullName,
  phone,
  shippingAddress,
}: SaveCheckoutProfileParams): Promise<void> {
  try {
    const supabase = createServiceClient();

    const nextFullName = clean(fullName);
    const nextPhone    = clean(phone);

    if (nextFullName || nextPhone) {
      const { data: current, error: readError } = await supabase
        .from('customers')
        .select('full_name, phone')
        .eq('id', customerId)
        .eq('tenant_id', tenantId)
        .maybeSingle<{ full_name: string | null; phone: string | null }>();

      if (readError) {
        console.error('[saveCheckoutProfile] customer read failed:', readError);
      } else if (current) {
        const patch: { full_name?: string; phone?: string } = {};
        if (nextFullName && nextFullName !== current.full_name) patch.full_name = nextFullName;
        if (nextPhone    && nextPhone    !== current.phone)     patch.phone     = nextPhone;

        if (Object.keys(patch).length > 0) {
          const { error: updateError } = await supabase
            .from('customers')
            .update(patch)
            .eq('id', customerId)
            .eq('tenant_id', tenantId);

          if (updateError) {
            console.error('[saveCheckoutProfile] customer update failed:', updateError);
          } else {
            console.info(
              '[saveCheckoutProfile] customer profile updated — id:', customerId,
              '— fields:', Object.keys(patch).join(','),
            );
          }
        }
      }
    }

    // Pickup (o qualunque ordine senza indirizzo): niente da salvare qui.
    if (!shippingAddress?.line1 || !shippingAddress.city || !shippingAddress.postal_code) {
      return;
    }

    const { error: addressError } = await supabase.rpc('upsert_default_address', {
      p_customer_id: customerId,
      p_tenant_id:   tenantId,
      p_full_name:   nextFullName ?? shippingAddress.full_name ?? '',
      p_line1:       shippingAddress.line1,
      p_line2:       clean(shippingAddress.line2),
      p_city:        shippingAddress.city,
      p_postal_code: shippingAddress.postal_code,
      p_country:     shippingAddress.country || 'IT',
    });

    if (addressError) {
      console.error('[saveCheckoutProfile] default address upsert failed:', addressError);
    } else {
      console.info('[saveCheckoutProfile] default address saved — customer:', customerId);
    }
  } catch (err) {
    // Rete/DB irraggiungibile, RPC inesistente, qualunque cosa: si logga e
    // basta. Il chiamante (checkout) non deve nemmeno accorgersene.
    console.error('[saveCheckoutProfile] unexpected failure (ignored):', err);
  }
}
