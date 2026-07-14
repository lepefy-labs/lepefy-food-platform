export async function removeBackground(buffer: Buffer, filename: string): Promise<Buffer> {
  const url = process.env.REMBG_URL;
  if (!url) throw new Error('REMBG_URL non configurata');

  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(buffer)]), filename);

  const headers: Record<string, string> = {};
  if (process.env.REMBG_AUTH) {
    headers['Authorization'] = `Basic ${Buffer.from(process.env.REMBG_AUTH).toString('base64')}`;
  }

  const res = await fetch(`${url}/api/remove`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`rembg error ${res.status}: ${text}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
