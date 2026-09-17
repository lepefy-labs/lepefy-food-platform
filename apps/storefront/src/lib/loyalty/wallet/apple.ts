import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { WalletCard } from './google';
import { signManifest, zipPass } from './passArchive';

interface Config {
  passTypeId: string; teamId: string; certificate: string; privateKey: string;
  wwdr: string; passphrase?: string;
}

function rgb(hex: string): string {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3 ? normalized.split('').map(c => c + c).join('') : normalized;
  if (!/^[0-9a-f]{6}$/i.test(value)) return 'rgb(25, 91, 158)';
  return 'rgb(' + [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16)).join(', ') + ')';
}

export function applePassJson(card: WalletCard, config: Pick<Config, 'passTypeId' | 'teamId'>) {
  return {
    formatVersion: 1, passTypeIdentifier: config.passTypeId, teamIdentifier: config.teamId,
    serialNumber: card.tenantId + '_' + card.customerId,
    organizationName: card.brand.name, description: 'Carte de fidélité ' + card.brand.name,
    logoText: card.brand.name + ' Club',
    backgroundColor: rgb(card.brand.background), foregroundColor: rgb(card.brand.foreground),
    labelColor: rgb(card.brand.foreground),
    barcodes: [{ format: 'PKBarcodeFormatQR', message: card.cardNumber,
      messageEncoding: 'iso-8859-1', altText: card.cardNumber }],
    storeCard: {
      headerFields: [{ key: 'points', label: 'POINTS CONFIRMÉS', value: card.balance, numberStyle: 'PKNumberStyleDecimal' }],
      primaryFields: [{ key: 'member', label: 'MEMBRE', value: card.fullName || 'Client' }],
      auxiliaryFields: [{ key: 'number', label: 'NUMÉRO DE CARTE', value: card.cardNumber }],
      backFields: [
        { key: 'account', label: 'Ma carte et mon solde actuel', value: card.accountUrl },
        { key: 'balance-info', label: 'Solde de points',
          value: 'Solde au dernier ajout de la carte. Ajoutez à nouveau la carte depuis votre compte pour actualiser le solde.' },
        { key: 'support', label: 'Contact', value: new URL(card.accountUrl).origin + '/contact' },
      ],
    },
  };
}

async function logoSource(card: WalletCard): Promise<Buffer> {
  if (card.brand.logoUrl) {
    const url = new URL(card.brand.logoUrl);
    const hosts = [
      new URL(card.accountUrl).hostname,
      ...(process.env.NEXT_PUBLIC_SUPABASE_URL ? [new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname] : []),
      ...(process.env.LOYALTY_WALLET_ASSET_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean),
    ];
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname)) throw new Error('Wallet logo host is not allowed');
    const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Wallet logo download failed');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing logo body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) throw new Error('Wallet logo exceeds 2 MB');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks);
  }
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="24" fill="' +
    (/^#[0-9a-f]{6}$/i.test(card.brand.background) ? card.brand.background : '#195B9E') + '"/></svg>');
}

export async function issueAppleWallet(card: WalletCard, config: Config): Promise<Buffer> {
  const logo = await logoSource(card);
  const files: Record<string, Buffer> = {
    'pass.json': Buffer.from(JSON.stringify(applePassJson(card, config))),
  };
  for (const scale of [1, 2, 3]) {
    const suffix = scale === 1 ? '' : '@' + scale + 'x';
    files['icon' + suffix + '.png'] = await sharp(logo, { limitInputPixels: 10000000 })
      .resize(29 * scale, 29 * scale, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
    files['logo' + suffix + '.png'] = await sharp(logo, { limitInputPixels: 10000000 })
      .resize(160 * scale, 50 * scale, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  }
  const manifest = Buffer.from(JSON.stringify(Object.fromEntries(
    Object.entries(files).map(([name, data]) => [name, createHash('sha1').update(data).digest('hex')]),
  )));
  files['manifest.json'] = manifest;
  files.signature = signManifest(manifest, config.certificate, config.privateKey, config.wwdr, config.passphrase);
  return zipPass(files);
}
