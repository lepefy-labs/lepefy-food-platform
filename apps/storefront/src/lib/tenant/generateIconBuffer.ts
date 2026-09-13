import sharp from 'sharp';

interface GenerateIconBufferParams {
  logoUrl: string;
  size: number;
}

interface GenerateTenantAppIconBufferParams {
  imageUrl: string;
  size: number;
  backgroundColor: string;
}

async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`generateIconBuffer: échec du fetch de l’image (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// Generic transparent "contain" resize retained for normal logos and the card icon.
export async function generateIconBuffer({ logoUrl, size }: GenerateIconBufferParams): Promise<Buffer> {
  const imageBuffer = await fetchImageBuffer(logoUrl);
  return sharp(imageBuffer)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// Dedicated app artwork stays untouched when fully opaque. Transparent artwork
// is centered without crop/stretch, then flattened onto the tenant-color canvas.
export async function generateTenantAppIconBuffer({
  imageUrl,
  size,
  backgroundColor,
}: GenerateTenantAppIconBufferParams): Promise<Buffer> {
  const imageBuffer = await fetchImageBuffer(imageUrl);
  const stats = await sharp(imageBuffer, { failOn: 'error' }).stats();

  const resized = sharp(imageBuffer, { failOn: 'error' })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });

  if (stats.isOpaque) {
    return resized.png().toBuffer();
  }

  return resized.flatten({ background: backgroundColor }).png().toBuffer();
}
