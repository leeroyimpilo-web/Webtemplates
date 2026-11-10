/**
 * PEND/2 chunk protocol: receiver ACKs a 1 MiB window only after disk writes.
 * This bounds the application's receive queue to approximately one window.
 * On-the-wire chunks are exactly <=64 KiB; file contents never reach Supabase.
 */
export const CHUNK_BYTES = 64 * 1024;
export const ACK_WINDOW_BYTES = 1024 * 1024;
const DATA_CHANNEL_HIGH_WATER = 1024 * 1024;
const DATA_CHANNEL_LOW_WATER = 256 * 1024;

export interface TransferHeader {
  type: "header";
  protocol: 2;
  transfer_id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  total_chunks: number;
  chunk_size: 65536;
}
export type TransferControl = TransferHeader | { type: "ready"; resume_from_byte: 0 }
  | { type: "ack"; received_bytes: number }
  | { type: "pause" } | { type: "resume" }
  | { type: "end" } | { type: "cancel" } | { type: "finished" }
  | { type: "error"; message: string };

export function sendControl(channel: RTCDataChannel, message: TransferControl) {
  if (channel.readyState !== "open") throw new Error("Peer connection is closed.");
  channel.send(JSON.stringify(message));
}

export function parseControl(value: string): TransferControl {
  const item: unknown = JSON.parse(value);
  if (!item || typeof item !== "object" || !("type" in item) || typeof item.type !== "string") {
    throw new Error("Invalid transfer control message.");
  }
  const control = item as TransferControl;
  if (!["header", "ready", "ack", "pause", "resume", "end", "cancel", "finished", "error"].includes(control.type)) {
    throw new Error("Unsupported transfer control message.");
  }
  return control;
}

export function validateHeader(item: TransferControl): asserts item is TransferHeader {
  if (item.type !== "header" || item.protocol !== 2 || item.chunk_size !== CHUNK_BYTES ||
    typeof item.file_name !== "string" || !item.file_name.length || item.file_name.length > 255 ||
    typeof item.file_type !== "string" || typeof item.transfer_id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(item.transfer_id) ||
    !Number.isSafeInteger(item.file_size) || item.file_size < 0 ||
    !Number.isSafeInteger(item.total_chunks) || item.total_chunks !== Math.ceil(item.file_size / CHUNK_BYTES)) {
    throw new Error("File metadata is invalid or uses an unsupported protocol.");
  }
}

export function safeFileName(name: string) {
  return name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/^\.+$/, "file").slice(0, 180) || "file";
}

export async function openSavePicker(fileName: string): Promise<FileSystemFileHandle> {
  const browser = window as Window & { showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle> };
  if (!browser.showSaveFilePicker) {
    throw new Error("Direct-to-disk saving is not supported in this browser. Try Chrome or Edge desktop. A mobile fallback requires further work.");
  }
  // Must be called synchronously as part of a user click, before any other awaited work.
  return browser.showSaveFilePicker({ suggestedName: safeFileName(fileName) });
}

/**
 * Sender session handles recipient disk-write ACKs, channel backpressure and
 * cooperative pause/resume while the *same* peer connection remains active.
 * A dropped connection cannot yet be resumed: that is Phase 3.
 */
export class TransferSender {
  private sentBytes = 0;
  private ackBytes = 0;
  private localPaused = false;
  private remotePaused = false;
  private started = false;
  private waiters = new Set<() => void>();

  constructor(
    private channel: RTCDataChannel,
    private file: File,
    private signal: AbortSignal,
    private onProgress: (confirmedBytes: number) => void,
    private onPauseChanged: (paused: boolean) => void,
  ) {
    this.channel.bufferedAmountLowThreshold = DATA_CHANNEL_LOW_WATER;
    this.channel.addEventListener("bufferedamountlow", this.wake);
    this.channel.addEventListener("close", this.wake);
    this.signal.addEventListener("abort", this.wake);
  }

  private wake = () => { for (const resolve of this.waiters) resolve(); this.waiters.clear(); };

  private async waitEvent() {
    if (this.signal.aborted || this.channel.readyState !== "open") throw new Error("Transfer interrupted.");
    await new Promise<void>((resolve) => { this.waiters.add(resolve); });
    if (this.signal.aborted || this.channel.readyState !== "open") throw new Error("Transfer interrupted.");
  }

  private async waitUntilWritable(nextChunkSize: number) {
    while (true) {
      if (this.signal.aborted || this.channel.readyState !== "open") throw new Error("Transfer interrupted.");
      if (!this.localPaused && !this.remotePaused &&
        this.sentBytes - this.ackBytes + nextChunkSize <= ACK_WINDOW_BYTES &&
        this.channel.bufferedAmount <= DATA_CHANNEL_HIGH_WATER) return;
      await this.waitEvent();
    }
  }

  acknowledge(bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < this.ackBytes || bytes > this.sentBytes) {
      throw new Error("Invalid receiver acknowledgement.");
    }
    if (bytes !== this.ackBytes) { this.ackBytes = bytes; this.onProgress(bytes); this.wake(); }
  }

  get confirmedBytes() { return this.ackBytes; }
  pause() { this.localPaused = true; sendControl(this.channel, { type: "pause" }); this.onPauseChanged(true); this.wake(); }
  resume() { this.localPaused = false; sendControl(this.channel, { type: "resume" }); this.onPauseChanged(this.remotePaused); this.wake(); }
  remotePause(paused: boolean) { this.remotePaused = paused; this.onPauseChanged(paused || this.localPaused); this.wake(); }

  async start() {
    if (this.started) throw new Error("Transfer already started.");
    this.started = true;
    const reader = this.file.stream().getReader();
    let carry = new Uint8Array(CHUNK_BYTES);
    let carryUsed = 0;
    const pushChunk = async (chunk: Uint8Array) => {
      await this.waitUntilWritable(chunk.byteLength);
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(chunk);
      this.channel.send(copy.buffer);
      this.sentBytes += chunk.byteLength;
    };
    try {
      while (true) {
        if (this.signal.aborted) throw new Error("Transfer interrupted.");
        const { value, done } = await reader.read();
        if (done) break;
        let offset = 0;
        while (offset < value.length) {
          const size = Math.min(CHUNK_BYTES - carryUsed, value.length - offset);
          carry.set(value.subarray(offset, offset + size), carryUsed);
          carryUsed += size;
          offset += size;
          if (carryUsed === CHUNK_BYTES) {
            await pushChunk(carry);
            carry = new Uint8Array(CHUNK_BYTES);
            carryUsed = 0;
          }
        }
      }
      if (carryUsed) await pushChunk(carry.subarray(0, carryUsed));
      if (this.sentBytes !== this.file.size) throw new Error("Source file ended prematurely.");
      while (this.ackBytes !== this.file.size) await this.waitEvent();
      sendControl(this.channel, { type: "end" });
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      this.channel.removeEventListener("bufferedamountlow", this.wake);
      this.channel.removeEventListener("close", this.wake);
      this.signal.removeEventListener("abort", this.wake);
      this.wake();
    }
  }
}
