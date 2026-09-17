import { createHash, createPrivateKey, sign, X509Certificate } from 'node:crypto';

// Minimal DER encoding for detached CMS SignedData. Cryptographic operations
// remain in Node/OpenSSL; no private key or certificate is sent to the browser.
function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  let length: Buffer;
  if (body.length < 128) length = Buffer.from([body.length]);
  else {
    let hex = body.length.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    const bytes = Buffer.from(hex, 'hex');
    length = Buffer.concat([Buffer.from([0x80 | bytes.length]), bytes]);
  }
  return Buffer.concat([Buffer.from([tag]), length, body]);
}
const seq = (...parts: Buffer[]) => der(0x30, ...parts);
const set = (...parts: Buffer[]) => der(0x31, ...parts.sort(Buffer.compare));
const oid = (hex: string) => der(0x06, Buffer.from(hex, 'hex'));
const integerOne = Buffer.from([0x02, 0x01, 0x01]);
const dataOid = oid('2a864886f70d010701');
const sha256 = seq(oid('608648016503040201'), der(0x05));
const rsa = seq(oid('2a864886f70d010101'), der(0x05));

function element(buffer: Buffer, offset: number) {
  const start = offset;
  const tag = buffer[offset++];
  let length = buffer[offset++];
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4) throw new Error('Invalid DER length');
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + buffer[offset++];
  }
  const end = offset + length;
  if (end > buffer.length) throw new Error('Truncated DER');
  return { tag, start, content: offset, end, raw: buffer.subarray(start, end) };
}

export function signManifest(manifest: Buffer, certificate: string, privateKey: string, wwdr: string, passphrase?: string): Buffer {
  const cert = new X509Certificate(certificate);
  const intermediate = new X509Certificate(wwdr);
  const key = createPrivateKey({ key: privateKey, passphrase });
  if (key.asymmetricKeyType !== 'rsa' || !cert.checkPrivateKey(key)) throw new Error('Pass certificate/key mismatch');
  const root = element(cert.raw, 0);
  const tbs = element(cert.raw, root.content);
  let offset = tbs.content;
  let field = element(cert.raw, offset);
  if (field.tag === 0xa0) offset = field.end; // optional X.509 version
  const serial = element(cert.raw, offset);
  const algorithm = element(cert.raw, serial.end);
  const issuer = element(cert.raw, algorithm.end);
  const date = new Date().toISOString().replace(/\D/g, '').slice(2, 14) + 'Z';
  const attrs = set(
    seq(oid('2a864886f70d010903'), set(dataOid)),
    seq(oid('2a864886f70d010904'), set(der(0x04, createHash('sha256').update(manifest).digest()))),
    seq(oid('2a864886f70d010905'), set(der(0x17, Buffer.from(date)))),
  );
  const signature = sign('RSA-SHA256', attrs, key);
  const signedAttrs = Buffer.from(attrs);
  signedAttrs[0] = 0xa0; // IMPLICIT SET OF in SignerInfo
  const signer = seq(integerOne, seq(issuer.raw, serial.raw), sha256, signedAttrs, rsa, der(0x04, signature));
  const signedData = seq(integerOne, set(sha256), seq(dataOid),
    der(0xa0, ...[cert.raw, intermediate.raw].sort(Buffer.compare)), set(signer));
  return seq(oid('2a864886f70d010702'), der(0xa0, signedData));
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Small in-memory ZIP with stored entries, valid for the PassKit bundle.
export function zipPass(files: Record<string, Buffer>): Buffer {
  const entries: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const filename = Buffer.from(name);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(33, 12); // 1980-01-01
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    entries.push(header, filename, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += header.length + filename.length + data.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries, central, end]);
}
