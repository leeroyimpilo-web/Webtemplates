const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');

// Compile the source TypeScript in-memory. Tests exercise production code,
// not a separately maintained JavaScript reimplementation.
const source = readFileSync('src/lib/transfer/stream.ts', 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', js)(mod, mod.exports);
const { CHUNK_BYTES, ACK_WINDOW_BYTES, parseControl, validateHeader, safeFileName, TransferSender } = mod.exports;

class MockChannel extends EventTarget {
  readyState = 'open';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  messages = [];
  onSend = null;
  send(message) {
    if (this.readyState !== 'open') throw new Error('channel closed');
    this.messages.push(message);
    this.onSend?.(message);
  }
  close() { this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
}

function makeFile(bytes) {
  return new File([new Uint8Array(bytes)], 'test.bin', { type: 'application/octet-stream' });
}

test('header requires 64 KiB protocol, exact chunk count, safe sizes', () => {
  const valid = { type: 'header', protocol: 2, transfer_id: '00000000-0000-4000-8000-000000000000',
    file_name: 'movie.mp4', file_size: CHUNK_BYTES + 1, file_type: 'video/mp4', total_chunks: 2, chunk_size: CHUNK_BYTES };
  assert.doesNotThrow(() => validateHeader(valid));
  assert.throws(() => validateHeader({ ...valid, chunk_size: 1234 }));
  assert.throws(() => validateHeader({ ...valid, total_chunks: 1 }));
  assert.throws(() => validateHeader({ ...valid, file_size: Number.MAX_SAFE_INTEGER + 2 }));
  assert.equal(safeFileName('../../file.exe'), '.._.._file.exe');
  assert.throws(() => parseControl('{"type":"delete_everything"}'));
});

test('streaming 2.5 MiB sends 64 KiB chunks and waits for durable ACKs', async () => {
  const size = ACK_WINDOW_BYTES * 2 + CHUNK_BYTES / 2;
  const channel = new MockChannel();
  const acked = [];
  const controller = new AbortController();
  const sender = new TransferSender(channel, makeFile(size), controller.signal, n => acked.push(n), () => {});
  let windowSent = 0;
  let chunks = 0;
  channel.onSend = message => {
    if (message instanceof ArrayBuffer) {
      chunks++;
      assert(message.byteLength > 0 && message.byteLength <= CHUNK_BYTES);
      windowSent += message.byteLength;
      if (windowSent === ACK_WINDOW_BYTES || windowSent === ACK_WINDOW_BYTES * 2 || windowSent === size) {
        // Simulate an ACK only after the recipient had flushed the entire window.
        queueMicrotask(() => sender.acknowledge(windowSent));
      }
    }
  };
  await sender.start();
  assert.equal(windowSent, size);
  assert.equal(sender.confirmedBytes, size);
  assert.equal(chunks, Math.ceil(size / CHUNK_BYTES));
  assert(acked.length >= 3);
  assert.equal(JSON.parse(channel.messages.at(-1)).type, 'end');
});

test('pause inhibits sending additional chunks until resume', async () => {
  const channel = new MockChannel();
  const controller = new AbortController();
  let sent = 0;
  let resumed = false;
  const sender = new TransferSender(channel, makeFile(ACK_WINDOW_BYTES * 2), controller.signal, () => {}, () => {});
  channel.onSend = message => {
    if (!(message instanceof ArrayBuffer)) return;
    sent += message.byteLength;
    if (sent === ACK_WINDOW_BYTES) {
      sender.pause();
      queueMicrotask(() => {
        sender.acknowledge(sent);
        setImmediate(() => {
          assert.equal(sent, ACK_WINDOW_BYTES, 'no new chunks while paused');
          resumed = true;
          sender.resume();
        });
      });
    } else if (sent === ACK_WINDOW_BYTES * 2) {
      queueMicrotask(() => sender.acknowledge(sent));
    }
  };
  await sender.start();
  assert.equal(resumed, true);
  assert.equal(sent, ACK_WINDOW_BYTES * 2);
});

test('abort stops an incomplete transfer and never sends end', async () => {
  const channel = new MockChannel();
  const controller = new AbortController();
  let blocks = 0;
  channel.onSend = data => {
    if (data instanceof ArrayBuffer && ++blocks === 2) controller.abort();
  };
  const sender = new TransferSender(channel, makeFile(ACK_WINDOW_BYTES * 3), controller.signal, () => {}, () => {});
  await assert.rejects(sender.start(), /interrupt/i);
  assert.equal(channel.messages.some(x => typeof x === 'string' && JSON.parse(x).type === 'end'), false);
});


test('sender rejects forged acknowledgements beyond bytes sent', async () => {
  const channel = new MockChannel();
  const controller = new AbortController();
  let sender;
  let checked = false;
  channel.onSend = message => {
    if (!(message instanceof ArrayBuffer)) return;
    if (!checked) {
      checked = true;
      assert.throws(() => sender.acknowledge(2 * CHUNK_BYTES), /Invalid receiver acknowledgement/);
      controller.abort();
    }
  };
  sender = new TransferSender(channel, makeFile(ACK_WINDOW_BYTES), controller.signal, () => {}, () => {});
  await assert.rejects(sender.start(), /interrupt/i);
  assert.equal(checked, true);
});

test('1 GiB generated source remains chunked and bounded by acknowledgements', async () => {
  const virtualSize = 1024 ** 3;
  let remaining = virtualSize;
  const virtualFile = {
    size: virtualSize,
    stream: () => new ReadableStream({
      pull(controller) {
        if (remaining === 0) { controller.close(); return; }
        const size = Math.min(CHUNK_BYTES, remaining);
        controller.enqueue(new Uint8Array(size));
        remaining -= size;
      },
    }, { highWaterMark: 1 }),
  };
  const channel = new MockChannel();
  let seen = 0, bytes = 0;
  let sender;
  // This mock deliberately DISCARDs each received ArrayBuffer. It never allocates 1 GiB.
  channel.send = message => {
    if (message instanceof ArrayBuffer) {
      seen++;
      assert(message.byteLength <= CHUNK_BYTES);
      bytes += message.byteLength;
      if (bytes % ACK_WINDOW_BYTES === 0) queueMicrotask(() => sender.acknowledge(bytes));
    } else {
      channel.messages.push(message);
    }
  };
  sender = new TransferSender(channel, virtualFile, new AbortController().signal, () => {}, () => {});
  await sender.start();
  assert.equal(seen, virtualSize / CHUNK_BYTES);
  assert.equal(sender.confirmedBytes, virtualSize);
  assert.equal(channel.messages.length, 1);
  assert.equal(JSON.parse(channel.messages[0]).type, 'end');
});

test('receiver repeats hello until sender appears, then stops on close', async () => {
  const source = readFileSync('src/lib/transfer/rtc.ts', 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const rtcModule = { exports: {} };
  new Function('module', 'exports', js)(rtcModule, rtcModule.exports);
  const { SupabaseRtcPeer } = rtcModule.exports;
  const outbound = [];
  const socket = {
    on() { return this; },
    subscribe(callback) { queueMicrotask(() => callback('SUBSCRIBED')); return this; },
    async send(message) { outbound.push(message.payload); return 'ok'; },
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
    realtime: { setAuth() {} },
    channel: () => socket,
    removeChannel: async () => {},
  };
  const peer = new SupabaseRtcPeer({
    client, roomId: '00000000-0000-4000-8000-000000000000', deviceId: 'device-b',
    role: 'receiver', onState: () => {}, onChannel: () => {}, helloRetryMs: 10,
  });
  await peer.start();
  await new Promise(resolve => setTimeout(resolve, 42));
  assert(outbound.length >= 3, 'hello retried despite first broadcast being lost');
  assert(outbound.every(msg => msg.type === 'hello'));
  peer.close();
  const afterClose = outbound.length;
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(outbound.length, afterClose, 'no leaked retry timer after close');
});

test('reconnect resumes from receiver-confirmed 64 KiB boundary, never re-sends prefix', async () => {
  const size = CHUNK_BYTES * 23 + 123;
  const offset = CHUNK_BYTES * 8;
  const file = makeFile(size);
  const channel = new MockChannel();
  const confirmed = [];
  const sender = new TransferSender(channel, file, new AbortController().signal, n => confirmed.push(n), () => {});
  let sentBytes = offset;
  channel.onSend = message => {
    if (!(message instanceof ArrayBuffer)) return;
    sentBytes += message.byteLength;
    if (sentBytes - offset === ACK_WINDOW_BYTES || sentBytes === size) {
      queueMicrotask(() => sender.acknowledge(sentBytes));
    }
  };
  await sender.start(offset);
  assert.equal(sentBytes, size);
  assert.equal(sender.confirmedBytes, size);
  assert.equal(confirmed[0], offset);
  assert.equal(channel.messages.filter(m => m instanceof ArrayBuffer).reduce((n,m)=>n+m.byteLength,0),size-offset);
});

test('resume rejects arbitrary unaligned offsets', async () => {
  const channel = new MockChannel();
  const sender = new TransferSender(channel, makeFile(CHUNK_BYTES*2), new AbortController().signal,()=>{},()=>{});
  await assert.rejects(sender.start(12345),/resume offset/i);
});
