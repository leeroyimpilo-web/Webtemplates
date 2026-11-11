/** JPEG previews over WebRTC DataChannel only. Supabase carries no image bytes. */
export const MAX_THUMBNAIL_BYTES = 200 * 1024;
const PART_BYTES = 48 * 1024;
const MAX_PARTS = 5;

export function splitPreview(base64, transferId) {
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length > Math.ceil(MAX_THUMBNAIL_BYTES / 3) * 4 + 8)
    throw new Error('Invalid image preview.');
  const partSize = PART_BYTES * 4 / 3;
  const count = Math.ceil(base64.length / partSize);
  if(count < 1 || count > MAX_PARTS) throw new Error('Preview too large.');
  return Array.from({ length: count }, (_, index) => ({
    type: 'preview', transfer_id: transferId, index, total: count,
    mime: 'image/jpeg', data: base64.slice(index * partSize, (index + 1) * partSize),
  }));
}

export function acceptPreviewChunk(state, message, expectedTransferId) {
  if(!message || message.type !== 'preview' || message.transfer_id !== expectedTransferId ||
     message.mime !== 'image/jpeg' || !Number.isSafeInteger(message.index) || !Number.isSafeInteger(message.total) ||
     message.total < 1 || message.total > MAX_PARTS || message.index < 0 || message.index >= message.total ||
     typeof message.data !== 'string' || message.data.length > PART_BYTES * 4 / 3 ||
     !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)) throw new Error('Malformed thumbnail chunk.');
  if(state.total !== null && state.total !== message.total) throw new Error('Conflicting thumbnail chunks.');
  state.total=message.total;
  if(state.parts.has(message.index) && state.parts.get(message.index)!==message.data)throw new Error('Conflicting thumbnail part.');
  state.parts.set(message.index,message.data);
  if(state.parts.size!==state.total)return null;
  const combined=Array.from({length:state.total},(_,i)=>state.parts.get(i)).join('');
  if(combined.length>Math.ceil(MAX_THUMBNAIL_BYTES/3)*4+8)throw new Error('Preview exceeds size limit.');
  return `data:image/jpeg;base64,${combined}`;
}
