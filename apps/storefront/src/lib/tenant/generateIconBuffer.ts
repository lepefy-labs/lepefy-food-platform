import sharp from 'sharp';

interface GenerateIconBufferParams {
  logoUrl: string;
  size: number;
}

interface GenerateTenantAppIconBufferParams {
  imageUrl: string;
  size: number;
  backgroundColor: string;
  artworkScale: number;
}

async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`generateIconBuffer: échec du fetch de l’image (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// Generic transparent "contain" resize retained for the independent card icon.
export async function generateIconBuffer({ logoUrl, size }: GenerateIconBufferParams): Promise<Buffer> {
  const imageBuffer = await fetchImageBuffer(logoUrl);
  return sharp(imageBuffer)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// app_icon_url and logo_url are artwork sources, not finished launcher icons.
// Transparent/uniform edge padding is trimmed, proportions are preserved, and
// the centered artwork is composed onto the full tenant-color canvas.
export async function generateTenantAppIconBuffer({
  imageUrl,
  size,
  backgroundColor,
  artworkScale,
}: GenerateTenantAppIconBufferParams): Promise<Buffer> {
  const imageBuffer = await fetchImageBuffer(imageUrl);
  const artworkSize = Math.max(1, Math.round(size * artworkScale));
  const artwork = await sharp(imageBuffer, { failOn: 'error' })
    .trim({ threshold: 10 })
    .resize(artworkSize, artworkSize, {
      fit: 'inside',
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const metadata = await sharp(artwork).metadata();
  const width = metadata.width ?? artworkSize;
  const height = metadata.height ?? artworkSize;

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: backgroundColor,
    },
  })
    .composite([{
      input: artwork,
      left: Math.round((size - width) / 2),
      top: Math.round((size - height) / 2),
    }])
    .flatten({ background: backgroundColor })
    .png()
    .toBuffer();
}
