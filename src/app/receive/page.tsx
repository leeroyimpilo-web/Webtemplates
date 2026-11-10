"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDevice } from "@/components/device-provider";
import { getSupabase } from "@/lib/supabase";
import { joinTransferRoom } from "@/lib/transfer/rooms";
import { SupabaseRtcPeer, type PeerState } from "@/lib/transfer/rtc";
import { openSavePicker, type TransferControl, type TransferHeader } from "@/lib/transfer/stream";
import { db } from "@/lib/db";

export default function ReceivePage() {
  const { device } = useDevice();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("Enter the sender’s one-time code.");
  const [state, setState] = useState<PeerState>("waiting");
  const [error, setError] = useState("");
  const [header, setHeader] = useState<TransferHeader | null>(null);
  const [written, setWritten] = useState(0);
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const peer = useRef<SupabaseRtcPeer | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const writer = useRef<FileSystemWritableFileStream | null>(null);
  const headerRef = useRef<TransferHeader | null>(null);
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const bytes = useRef(0);

  useEffect(() => () => { peer.current?.close(); void writer.current?.abort().catch(() => undefined); }, []);

  const connect = async () => {
    if (!device || busy) return;
    const client = getSupabase();
    if (!client) { setError("Supabase not configured."); return; }
    setError(""); setBusy(true); setWritten(0); setComplete(false);
    peer.current?.close();
    try {
      const roomId = await joinTransferRoom(client, device.id, code);
      setStatus("Joined session. Connecting directly to sender…");
      const connection = new SupabaseRtcPeer({
        client, roomId, deviceId: device.id, role: "receiver",
        onState: next => { setState(next); if (next === "disconnected") setStatus("Connection lost. Resuming is planned for Sprint 2."); },
        onChannel: dc => {
          dataChannel.current = dc;
          dc.binaryType = "arraybuffer";
          dc.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
            // Serialize all disk writes; DataChannel ordering alone does not await async IO.
            writeChain.current = writeChain.current.then(async () => {
              if (typeof event.data === "string") {
                const message = JSON.parse(event.data) as TransferControl;
                if (message.type === "header") {
                  if (!Number.isSafeInteger(message.file_size) || message.file_size < 0 || !Number.isInteger(message.total_chunks)) throw new Error("Invalid file metadata.");
                  headerRef.current = message; setHeader(message); setStatus("Review this file and choose where to save it.");
                } else if (message.type === "end") {
                  if (!writer.current || !headerRef.current || bytes.current !== headerRef.current.file_size) throw new Error("Received file is incomplete. Partial download was not accepted.");
                  await writer.current.close(); writer.current = null;
                  await db.inbox.put({ transferId: headerRef.current.transfer_id, senderId: roomId,
                    fileName: headerRef.current.file_name, fileSize: bytes.current, receivedAt: Date.now() });
                  if (dc.readyState === "open") dc.send(JSON.stringify({ type: "finished" } satisfies TransferControl));
                  setComplete(true); setStatus("File saved to your chosen location."); setBusy(false);
                } else if (message.type === "cancel") {
                  if (writer.current) await writer.current.abort();
                  writer.current = null; setStatus("Sender cancelled."); setBusy(false);
                }
              } else if (event.data instanceof ArrayBuffer) {
                if (!writer.current || !headerRef.current) throw new Error("File arrived before you accepted it.");
                const next = bytes.current + event.data.byteLength;
                if (next > headerRef.current.file_size) throw new Error("More data than declared was received.");
                await writer.current.write(event.data);
                bytes.current = next; setWritten(next);
              }
            }).catch(async cause => {
              setError(cause instanceof Error ? cause.message : "Receive failed."); setBusy(false);
              if (writer.current) await writer.current.abort().catch(() => undefined);
              writer.current = null;
              if (dc.readyState === "open") dc.send(JSON.stringify({ type: "cancel" } satisfies TransferControl));
            });
          };
          dc.onclose = () => { if (!complete) setStatus("Peer connection closed."); };
        },
      });
      peer.current = connection;
      await connection.start();
    } catch (cause) { setBusy(false); setError(cause instanceof Error ? cause.message : "Could not join this room."); }
  };

  const accept = async () => {
    const current = headerRef.current;
    if (!current || !dataChannel.current || dataChannel.current.readyState !== "open") return;
    setError("");
    try {
      const safeName = current.file_name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 180);
      const handle = await openSavePicker(safeName);
      writer.current = await handle.createWritable();
      bytes.current = 0;
      setStatus("Receiving encrypted chunks directly to disk…");
      dataChannel.current.send(JSON.stringify({ type: "ready" } satisfies TransferControl));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open save location."); }
  };

  const decline = () => {
    if (dataChannel.current?.readyState === "open") dataChannel.current.send(JSON.stringify({ type: "cancel" } satisfies TransferControl));
    peer.current?.close(); peer.current = null; setBusy(false); setHeader(null); headerRef.current = null; setStatus("Declined.");
  };
  return <div className="space-y-7">
    <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-violet-300">PHASE 1 · RECEIVE</p><h1 className="mt-2 text-3xl font-bold">Receive a file</h1><p className="mt-2 text-white/55">Enter the six-digit code shared by the sender. No pairing or automatic downloads yet.</p></div>
    <Card className="max-w-2xl space-y-5 p-6 sm:p-8">
      <label className="block text-sm font-semibold" htmlFor="transfer-code">One-time transfer code</label>
      <input id="transfer-code" type="text" inputMode="numeric" autoComplete="off" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} disabled={busy}
        className="w-full rounded-xl border border-white/15 bg-white/5 p-4 text-center font-mono text-4xl tracking-[0.15em] outline-none focus:border-violet-300" placeholder="000000" />
      <Button className="w-full" onClick={() => void connect()} disabled={busy || code.length !== 6}>Connect to sender</Button>
      <p role="status" className="text-sm text-white/60">{status} {busy && `(${state})`}</p>
      {header && <div className="space-y-4 rounded-2xl border border-white/15 bg-white/5 p-5"><p className="font-semibold">Incoming: {header.file_name}</p>
        <p className="text-xs text-white/50">{(header.file_size / (1024 * 1024)).toFixed(2)} MiB · {header.file_type}</p>
        {written === 0 && !complete && !writer.current && <div className="flex flex-wrap gap-3"><Button onClick={() => void accept()}><Download size={17}/> Choose save location & accept</Button><Button variant="outline" onClick={decline}>Decline</Button></div>}
        <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-cyan-400" style={{ width: `${header.file_size ? Math.min(100, written / header.file_size * 100) : complete ? 100 : 0}%` }}/></div>
        <p className="text-xs text-white/55">{written.toLocaleString()} / {header.file_size.toLocaleString()} bytes {complete && "· Saved"}</p></div>}
      {error && <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
      <p className="flex items-start gap-2 text-xs text-amber-200/80"><ShieldAlert size={18} className="shrink-0"/> This is an untrusted transfer. Check the sender and file type before accepting. Never open unexpected executable files.</p>
    </Card><Link className="text-sm text-violet-300 underline" href="/send">Send a file instead</Link>
    <p className="text-xs text-white/45">For large files, a compatible browser with File System Access API support is required so downloads stream to disk without filling memory. Both devices must remain online and keep this page open.</p>
  </div>;
}
