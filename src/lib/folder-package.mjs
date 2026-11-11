/** PEND folder container v1: 8-byte magic, u32 BE JSON length, JSON manifest, raw file payloads.
 * Input Files are referenced as Blob parts, so packaging never loads their bytes into JS memory.
 * This format is PEND-specific, not ZIP. Never auto-accept or auto-execute a folder package.
 */
const MAGIC = 'PENDFDR1';
const HEADER_BYTES = 12;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_FILES = 10000;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export function validateFolderPath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Unsafe folder file path.');
  }
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p.length > 255 || p === '__proto__')) {
    throw new Error('Unsafe folder traversal or duplicate path component.');
  }
  return parts;
}

export function createFolderPackage(files, folderName = 'Shared Folder') {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) throw new Error('Choose 1–10,000 files in a folder.');
  const seen = new Set();
  const entries = [];
  const parts = [];
  let offset = 0;
  for (const item of files) {
    const file = item?.file;
    if (!(file instanceof Blob) || !Number.isSafeInteger(file.size)) throw new Error('Invalid file in folder.');
    const path = item.relativePath;
    validateFolderPath(path);
    if (seen.has(path)) throw new Error('Duplicate folder path.');
    seen.add(path);
    if (!Number.isSafeInteger(offset + file.size)) throw new Error('Folder exceeds supported browser file size.');
    entries.push({ path, size: file.size, offset, type: String(file.type || '').slice(0, 128) });
    offset += file.size;
    parts.push(file);
  }
  const json = enc.encode(JSON.stringify({ version: 1, files: entries }));
  if (json.byteLength > MAX_MANIFEST_BYTES) throw new Error('Folder manifest too large.');
  const header = new Uint8Array(HEADER_BYTES);
  header.set(enc.encode(MAGIC));
  new DataView(header.buffer).setUint32(8, json.byteLength, false);
  const safeName = String(folderName).replace(/[^a-zA-Z0-9 _.-]/g, '_').replace(/^\.+$/, 'Folder').slice(0, 120) || 'Folder';
  return new File([header, json, ...parts], `${safeName}.pendpack`, { type: 'application/vnd.pend.folder' });
}

export async function readFolderManifest(blob) {
  if (!(blob instanceof Blob) || blob.size < HEADER_BYTES) throw new Error('Invalid folder package.');
  const header = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());
  if (dec.decode(header.subarray(0, 8)) !== MAGIC) throw new Error('Wrong folder package format.');
  const n = new DataView(header.buffer).getUint32(8, false);
  if (n === 0 || n > MAX_MANIFEST_BYTES || HEADER_BYTES + n > blob.size) throw new Error('Invalid manifest length.');
  const manifest = JSON.parse(dec.decode(await blob.slice(HEADER_BYTES, HEADER_BYTES + n).arrayBuffer()));
  if (manifest?.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > MAX_FILES) {
    throw new Error('Unsupported folder manifest.');
  }
  let previousEnd = 0;
  const seen = new Set();
  for (const item of manifest.files) {
    if (!item || typeof item.path !== 'string') throw new Error('Malformed manifest entry.');
    validateFolderPath(item.path);
    if (seen.has(item.path)) throw new Error('Duplicate package filename.');
    seen.add(item.path);
    if (!Number.isSafeInteger(item.size) || item.size < 0 || !Number.isSafeInteger(item.offset) || item.offset !== previousEnd) {
      throw new Error('Invalid file position or size.');
    }
    previousEnd += item.size;
    if (!Number.isSafeInteger(previousEnd)) throw new Error('Invalid package size.');
  }
  if (HEADER_BYTES + n + previousEnd !== blob.size) throw new Error('Folder payload size mismatch.');
  return { entries: manifest.files, dataOffset: HEADER_BYTES + n };
}

/** Extracts with bounded 64 KiB reads. Only call after an explicit user gesture/approval. */
export async function extractFolderPackage(blob, rootDirectory) {
  const { entries, dataOffset } = await readFolderManifest(blob);
  for (const entry of entries) {
    const parts = validateFolderPath(entry.path);
    let parent = rootDirectory;
    for (const dir of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(dir, { create: true });
    const handle = await parent.getFileHandle(parts.at(-1), { create: true });
    const writer = await handle.createWritable();
    try {
      for (let position = 0; position < entry.size; position += 65536) {
        const chunk = await blob.slice(dataOffset + entry.offset + position, dataOffset + entry.offset + Math.min(entry.size, position + 65536)).arrayBuffer();
        await writer.write(chunk);
      }
      await writer.close();
    } catch (error) { await writer.abort().catch(() => {}); throw error; }
  }
  return entries.length;
}
