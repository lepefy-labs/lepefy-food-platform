import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { notifyN8n } from '@/lib/events/notifyN8n';

interface InquiryBody {
  customer_name:   string;
  customer_email:  string;
  customer_phone?: string | null;
  date_souhaitee?: string | null;
  nombre_invites?: number | null;
  message?:        string | null;
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(slug);

    if (!tenant.services_enabled) {
      return NextResponse.json({ error: 'Module services non activé.' }, { status: 404 });
    }

    const body: InquiryBody = await req.json();
    const { customer_name, customer_email, customer_phone, date_souhaitee, nombre_invites, message } = body;

    if (!customer_name?.trim() || !customer_email?.trim()) {
      return NextResponse.json({ error: 'Nom et email sont obligatoires.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: offering } = await supabase
      .from('service_offerings')
      .select('id, tenant_id, title, cta_type, active')
      .eq('slug', params.slug)
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (!offering || !offering.active || offering.cta_type !== 'devis') {
      return NextResponse.json({ error: 'Service introuvable ou non disponible.' }, { status: 404 });
    }

    const { data: inquiry, error } = await supabase
      .from('service_inquiries')
      .insert({
        tenant_id:            tenant.id,
        service_offering_id:  offering.id,
        customer_name:        customer_name.trim(),
        customer_email:       customer_email.trim(),
        customer_phone:       customer_phone?.trim() || null,
        date_souhaitee:       date_souhaitee || null,
        nombre_invites:       nombre_invites ?? null,
        message:              message?.trim() || null,
        status:               'nouveau',
      })
      .select('id')
      .single();

    if (error || !inquiry) {
      console.error('[services/inquiry] insert error:', error);
      return NextResponse.json({ error: 'Erreur lors de l\'envoi de la demande.' }, { status: 500 });
    }

    console.info('[services/inquiry] inquiry created — id:', inquiry.id, '— service:', offering.id);

    const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
    await notifyN8n('/webhook/service-inquiry-created', {
      inquiryId:      inquiry.id,
      serviceTitle:   offering.title,
      customerName:   customer_name.trim(),
      customerEmail:  customer_email.trim(),
      customerPhone:  customer_phone?.trim() || null,
      dateSouhaitee:  date_souhaitee || null,
      nombreInvites:  nombre_invites ?? null,
      message:        message?.trim() || null,
      adminLink:      `${storefrontUrl}/admin/evenementiel/devis`,
    });

    return NextResponse.json({ success: true, inquiryId: inquiry.id });
  } catch (err) {
    console.error('[services/inquiry] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
