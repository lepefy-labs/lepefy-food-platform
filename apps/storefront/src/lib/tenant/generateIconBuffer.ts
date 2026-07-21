import sharp from 'sharp';

interface GenerateIconBufferParams {
  logoUrl: string;
  size: number;
}

// Ritorna un Buffer PNG del logo ridimensionato con "contain" e padding
// trasparente — stessa logica già in uso e verificata in produzione per
// /api/pwa-icon, solo estratta per essere riusabile.
export async function generateIconBuffer({ logoUrl, size }: GenerateIconBufferParams): Promise<Buffer> {
  const logoRes = await fetch(logoUrl);
  if (!logoRes.ok) {
    throw new Error(`generateIconBuffer: échec du fetch du logo (${logoRes.status})`);
  }
  const logoBuffer = Buffer.from(await logoRes.arrayBuffer());

  return sharp(logoBuffer)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}
