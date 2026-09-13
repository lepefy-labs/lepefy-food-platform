import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { removeBackground } from '@/lib/images/removeBackground';
import {
  MAX_PRODUCT_IMAGES,
  normalizeProductImages,
} from '@/lib/catalog/productImages';
import type { ProductImage } from '@lepefy/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILE_BYTES = 4 * 1024 * 1024;

function getFileFormat(file: File): { extension: string; contentType: string } | null {
  if (file.type === 'image/png') return { extension: 'png', contentType: 'image/png' };
  if (file.type === 'image/webp') return { extension: 'webp', contentType: 'image/webp' };
  if (file.type === 'image/jpeg') return { extension: 'jpg', contentType: 'image/jpeg' };
  return null;
}

function managedStoragePath(imageUrl: string, tenantId: string, productId: string): string | null {
  try {
    const marker = '/storage/v1/object/public/assets/';
    const pathname = new URL(imageUrl).pathname;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const path = decodeURIComponent(pathname.slice(markerIndex + marker.length));
    const expectedPrefix = 'tenants/' + tenantId + '/products/' + productId + '/';
    return path.startsWith(expectedPrefix) ? path : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const formData = await req.formData();
  const multipleFiles = formData
    .getAll('files')
    .filter((value): value is File => value instanceof File && value.size > 0);
  const legacyFile = formData.get('file');
  const files = multipleFiles.length > 0
    ? multipleFiles
    : legacyFile instanceof File && legacyFile.size > 0
      ? [legacyFile]
      : [];
  const additive = multipleFiles.length > 0;
  const productId = formData.get('productId');
  const shouldRemoveBg = formData.get('removeBackground') === 'true';

  if (typeof productId !== 'string' || files.length === 0) {
    return NextResponse.json({ error: 'Fichier ou produit manquant' }, { status: 400 });
  }

  const invalidFile = files.find((file) => !getFileFormat(file) || file.size > MAX_FILE_BYTES);
  if (invalidFile) {
    return NextResponse.json(
      { error: 'Formats acceptés : JPG, PNG ou WebP, 4 Mo maximum par image' },
      { status: 415 },
    );
  }

  const supabase = createServiceClient();
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, name, image_url, images')
    .eq('id', productId)
    .eq('tenant_id', tenant.id)
    .single();

  if (productError || !product) {
    return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 });
  }

  const existingImages = normalizeProductImages(product.images, product.image_url, product.name);
  if (additive && existingImages.length + files.length > MAX_PRODUCT_IMAGES) {
    return NextResponse.json(
      { error: 'La galerie est limitée à ' + MAX_PRODUCT_IMAGES + ' images' },
      { status: 400 },
    );
  }

  const uploadedPaths: string[] = [];
  const uploadedImages: ProductImage[] = [];

  try {
    for (const file of files) {
      const format = getFileFormat(file);
      if (!format) continue;

      let buffer: Buffer = Buffer.from(await file.arrayBuffer());
      let extension = format.extension;
      let contentType = format.contentType;

      if (shouldRemoveBg) {
        buffer = await removeBackground(buffer, file.name);
        extension = 'png';
        contentType = 'image/png';
      }

      const resized = await sharp(buffer)
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer();

      const path =
        'tenants/' + tenant.id + '/products/' + productId + '/' + randomUUID() + '.' + extension;
      const { error: uploadError } = await supabase.storage
        .from('assets')
        .upload(path, resized, { contentType, upsert: false });

      if (uploadError) throw new Error(uploadError.message);
      uploadedPaths.push(path);

      const url =
        process.env.NEXT_PUBLIC_SUPABASE_URL +
        '/storage/v1/object/public/assets/' +
        path +
        '?v=' +
        Date.now();
      uploadedImages.push({ url, alt: product.name });
    }

    const nextImages = additive
      ? normalizeProductImages([...existingImages, ...uploadedImages])
      : normalizeProductImages([...uploadedImages, ...existingImages.slice(1)]);

    const { error: updateError } = await supabase
      .from('products')
      .update({
        images: nextImages,
        image_url: nextImages[0]?.url ?? null,
      })
      .eq('id', productId)
      .eq('tenant_id', tenant.id);

    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({
      images: nextImages,
      imageUrl: nextImages[0]?.url ?? null,
    });
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from('assets').remove(uploadedPaths);
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Téléversement échoué' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as { productId?: unknown; imageUrl?: unknown };
  if (typeof body.productId !== 'string' || typeof body.imageUrl !== 'string') {
    return NextResponse.json({ error: 'Produit ou image manquant' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, name, image_url, images')
    .eq('id', body.productId)
    .eq('tenant_id', tenant.id)
    .single();

  if (productError || !product) {
    return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 });
  }

  const images = normalizeProductImages(product.images, product.image_url, product.name);
  if (!images.some((image) => image.url === body.imageUrl)) {
    return NextResponse.json({ error: 'Image introuvable' }, { status: 404 });
  }

  const nextImages = images.filter((image) => image.url !== body.imageUrl);
  const { error: updateError } = await supabase
    .from('products')
    .update({
      images: nextImages,
      image_url: nextImages[0]?.url ?? null,
    })
    .eq('id', body.productId)
    .eq('tenant_id', tenant.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const path = managedStoragePath(body.imageUrl, tenant.id, body.productId);
  if (path) {
    const { error: storageError } = await supabase.storage.from('assets').remove([path]);
    if (storageError) {
      console.error('[product-images] Suppression storage échouée:', storageError.message);
    }
  }

  return NextResponse.json({
    images: nextImages,
    imageUrl: nextImages[0]?.url ?? null,
  });
}
