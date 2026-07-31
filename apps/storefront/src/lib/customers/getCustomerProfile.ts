import { createServiceClient } from '@/lib/supabase/server';
import type { CustomerProfile, CustomerDefaultAddress } from './types';

interface CustomerRow {
  email:     string;
  full_name: string | null;
  phone:     string | null;
}

interface AddressRow {
  full_name:   string;
  line1:       string;
  line2:       string | null;
  city:        string;
  postal_code: string;
  country:     string;
}

// Legge il profilo di un cliente già autenticato (l'autenticazione è
// responsabilità del chiamante — qui customerId è considerato attendibile).
// Le query passano da createServiceClient() come nel resto del progetto, ma
// restano sempre vincolate a customer_id + tenant_id: nessuna riga di un altro
// cliente o di un altro tenant può essere restituita.
export async function getCustomerProfile(
  customerId: string,
  tenantId:   string,
): Promise<CustomerProfile | null> {
  const supabase = createServiceClient();

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('email, full_name, phone')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle<CustomerRow>();

  if (customerError || !customer) {
    if (customerError) console.error('[customers/me] customer lookup error:', customerError);
    return null;
  }

  // L'indirizzo è una comodità: se la lettura fallisce si restituisce comunque
  // il profilo (nome/telefono pre-compilati), mai un 500.
  const { data: address, error: addressError } = await supabase
    .from('addresses')
    .select('full_name, line1, line2, city, postal_code, country')
    .eq('customer_id', customerId)
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .limit(1)
    .maybeSingle<AddressRow>();

  if (addressError) {
    console.error('[customers/me] default address lookup error:', addressError);
  }

  const defaultAddress: CustomerDefaultAddress | null = address
    ? {
        fullName:   address.full_name,
        line1:      address.line1,
        line2:      address.line2,
        city:       address.city,
        postalCode: address.postal_code,
        country:    address.country,
      }
    : null;

  return {
    fullName: customer.full_name,
    phone:    customer.phone,
    email:    customer.email,
    defaultAddress,
  };
}
