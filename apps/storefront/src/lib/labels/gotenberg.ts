export async function htmlToPdf(html: string): Promise<Buffer> {
  const url = process.env.GOTENBERG_URL; // es. http://<hetzner-ip>:3300
  if (!url) throw new Error('GOTENBERG_URL non configurata');

  const formData = new FormData();
  formData.append('files', new Blob([html], { type: 'text/html' }), 'index.html');

  const res = await fetch(`${url}/forms/chromium/convert/html`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gotenberg error ${res.status}: ${text}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
