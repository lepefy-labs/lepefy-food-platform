// Minimal dependency-free ZIP reader — supports stored (method 0) and
// deflate (method 8) entries, which covers GeoNames' export files. No
// zip64/encryption/multi-disk support: not needed for these small archives,
// and pulling in a full unzip library is unnecessary for a one-off import.
import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;

export function readZipEntries(buffer: Buffer): ZipEntry[] {
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('zip_eocd_not_found');

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) throw new Error('zip_central_directory_corrupt');

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);

    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (compressionMethod === 0) data = Buffer.from(compressedData);
    else if (compressionMethod === 8) data = inflateRawSync(compressedData);
    else throw new Error(`zip_unsupported_compression_method_${compressionMethod}`);

    entries.push({ name: fileName, data });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}
