export const CHUNK_BYTES = 64 * 1024;
const HIGH_WATER = 1024 * 1024;
const LOW_WATER = 256 * 1024;

export interface TransferHeader {
  type: "header";
  transfer_id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  total_chunks: number;
}
export type TransferControl = TransferHeader | { type: "ready" } | { type: "end" } | { type: "cancel" } | { type: "finished" };

export function openSavePicker(fileName: string): Promise<FileSystemFileHandle> {
  const browser = window as Window & { showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle> };
  if (!browser.showSaveFilePicker) {
    throw new Error("This browser cannot stream to disk. Use Chrome or Edge desktop, or an Android browser with supported file saving.");
  }
  // Always called from a direct click; browser requires user activation.
  return browser.showSaveFilePicker({ suggestedName: fileName });
}

async function waitForBackpressure(channel: RTCDataChannel, signal: AbortSignal) {
  if (channel.readyState !== "open" || signal.aborted) throw new Error("Transfer interrupted.");
  if (channel.bufferedAmount <= HIGH_WATER) return;
  channel.bufferedAmountLowThreshold = LOW_WATER;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { channel.removeEventListener("bufferedamountlow", low); channel.removeEventListener("close", fail); signal.removeEventListener("abort", fail); };
    const low = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("Transfer interrupted.")); };
    channel.addEventListener("bufferedamountlow", low);
    channel.addEventListener("close", fail);
    signal.addEventListener("abort", fail, { once: true });
    if (channel.bufferedAmount <= LOW_WATER) low();
  });
}

/** file.stream() is consumed incrementally: no file-sized in-memory buffer. */
export async function sendFileStream(channel: RTCDataChannel, file: File, signal: AbortSignal, progress: (bytes: number) => void) {
  const reader = file.stream().getReader();
  let carry = new Uint8Array(CHUNK_BYTES);
  let carryUsed = 0;
  let sent = 0;
  const sendChunk = async (chunk: Uint8Array) => {
    await waitForBackpressure(channel, signal);
    // Copy just the current 64-KiB-or-less block into a transferable ArrayBuffer.
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    channel.send(copy.buffer);
    sent += chunk.byteLength;
    progress(sent);
  };
  try {
    for (;;) {
      if (signal.aborted) throw new Error("Transfer cancelled.");
      const { value, done } = await reader.read();
      if (done) break;
      let offset = 0;
      while (offset < value.length) {
        const amount = Math.min(CHUNK_BYTES - carryUsed, value.length - offset);
        carry.set(value.subarray(offset, offset + amount), carryUsed);
        carryUsed += amount;
        offset += amount;
        if (carryUsed === CHUNK_BYTES) {
          await sendChunk(carry);
          carry = new Uint8Array(CHUNK_BYTES);
          carryUsed = 0;
        }
      }
    }
    if (carryUsed) await sendChunk(carry.subarray(0, carryUsed));
    if (sent !== file.size) throw new Error("Input stream ended before file size was reached.");
    await waitForBackpressure(channel, signal);
    channel.send(JSON.stringify({ type: "end" } satisfies TransferControl));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
