import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const formData  = await req.formData();
  const file      = formData.get('file') as File | null;
  const productId = formData.get('productId') as string | null;
  const slug      = formData.get('slug') as string | null;

  if (!file || !productId || !slug) {
    return NextResponse.json(
      { error: 'Missing file, productId or slug' },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const buffer   = Buffer.from(await file.arrayBuffer());
  const ext      =
    file.type === 'image/png'  ? 'png'  :
    file.type === 'image/webp' ? 'webp' :
    'jpg';
  const path = `products/${slug}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('assets')
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const imageUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/${path}`;

  const { error: dbErr } = await supabase
    .from('products')
    .update({ image_url: imageUrl })
    .eq('id', productId);

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  return NextResponse.json({ imageUrl });
}
