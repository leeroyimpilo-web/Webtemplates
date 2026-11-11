"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, Pause, Play, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDevice } from "@/components/device-provider";
import { getSupabase } from "@/lib/supabase";
import { joinTransferRoom } from "@/lib/transfer/rooms";
import { SupabaseRtcPeer, type PeerState } from "@/lib/transfer/rtc";
import { ACK_WINDOW_BYTES, CHUNK_BYTES, openSavePicker, parseControl, sendControl, validateHeader, type TransferHeader } from "@/lib/transfer/stream";
import { db } from "@/lib/db";
import { acceptPreviewChunk } from "@/lib/transfer/thumbnail.mjs";

export default function ReceivePage() {
  const { device } = useDevice();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("Enter the sender's one-time code.");
  const [state, setState] = useState<PeerState>("waiting");
  const [error, setError] = useState("");
  const [header, setHeader] = useState<TransferHeader | null>(null);
  const [written, setWritten] = useState(0);
  const [thumbnail,setThumbnail] = useState("");
  const previewParts = useRef<{total:number|null;parts:Map<number,string>}>({total:null,parts:new Map()});
  const [speed, setSpeed] = useState(0);
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [paused, setPaused] = useState(false);
  const peer = useRef<SupabaseRtcPeer | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const writer = useRef<FileSystemWritableFileStream | null>(null);
  const headerRef = useRef<TransferHeader | null>(null);
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const bytes = useRef(0);
  const lastAck = useRef(0);
  const finished = useRef(false);
  const startTime = useRef(0);
  const roomRef = useRef("");

  useEffect(() => () => { peer.current?.close(); void writer.current?.abort().catch(() => undefined); }, []);

  const connect = async () => {
    if (!device || busy) return;
    const client = getSupabase();
    if (!client) { setError("Supabase not configured."); return; }
    setError(""); setBusy(true); setWritten(0); setComplete(false); setAccepted(false); setPaused(false); setSpeed(0);
    peer.current?.close(); writeChain.current = Promise.resolve(); bytes.current = 0; lastAck.current = 0; finished.current = false; headerRef.current = null; setHeader(null);setThumbnail("");previewParts.current={total:null,parts:new Map()};
    try {
      const roomId = await joinTransferRoom(client, device.id, code);
      roomRef.current = roomId;
      setStatus("Code accepted. Connecting directly to sender…");
      const conn = new SupabaseRtcPeer({
        client, roomId, deviceId: device.id, role: "receiver",
        onState: next => {
          setState(next);
          if (next === "disconnected" && !finished.current) {
            void writer.current?.abort().catch(() => undefined);
            writer.current = null; setBusy(false); setAccepted(false);
            setError("Connection lost. This incomplete download has been discarded. Reconnect-resume is Phase 3.");
          }
        },
        onChannel: dc => {
          dataChannel.current = dc;
          dc.binaryType = "arraybuffer";
          dc.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
            // Serialise disk writes; memory usage is bounded by receiver ACKs.
            writeChain.current = writeChain.current.then(async () => {
              if (typeof event.data === "string") {
                const message = parseControl(event.data);
                if (message.type === "preview") {
                  const data=acceptPreviewChunk(previewParts.current,message,message.transfer_id);
                  if(data)setThumbnail(data);
                } else if (message.type === "header") {
                  if (headerRef.current) throw new Error("Unexpected second file header.");
                  validateHeader(message);
                  headerRef.current = message; setHeader(message);
                  setStatus("Review the file and manually choose where to save it.");
                } else if (message.type === "end") {
                  if (!writer.current || !headerRef.current || bytes.current !== headerRef.current.file_size) throw new Error("File incomplete or not accepted.");
                  await writer.current.close(); writer.current = null;
                  // Local inbox holds metadata only; the file was saved outside the browser.
                  await db.inbox.put({ transferId: headerRef.current.transfer_id, senderId: roomRef.current,
                    fileName: headerRef.current.file_name, fileSize: bytes.current, receivedAt: Date.now() });
                  await db.offsets.delete(headerRef.current.transfer_id);
                  if (dc.readyState === "open") sendControl(dc, { type: "finished" });
                  finished.current = true; setComplete(true); setBusy(false); setAccepted(false);
                  setStatus("File saved to your chosen location.");
                } else if (message.type === "cancel" || message.type === "error") {
                  if (writer.current) await writer.current.abort();
                  writer.current = null; setAccepted(false); setBusy(false);
                  setStatus(message.type === "error" ? "Sender reported an error." : "Sender cancelled the transfer.");
                  if (message.type === "error") setError(message.message);
                }
              } else if (event.data instanceof ArrayBuffer) {
                if (!writer.current || !headerRef.current || finished.current) throw new Error("Unexpected file data.");
                if (event.data.byteLength === 0 || event.data.byteLength > CHUNK_BYTES) throw new Error("Invalid chunk size.");
                const next = bytes.current + event.data.byteLength;
                if (next > headerRef.current.file_size) throw new Error("More bytes than expected.");
                await writer.current.write(event.data);
                bytes.current = next; setWritten(next);
                const elapsed = Math.max(0.1, (performance.now() - startTime.current) / 1000);
                setSpeed(next / elapsed);
                if (next - lastAck.current >= ACK_WINDOW_BYTES || next === headerRef.current.file_size) {
                  lastAck.current = next;
                  // Only acknowledge chunks successfully written to the disk stream.
                  if (dc.readyState === "open") sendControl(dc, { type: "ack", received_bytes: next });
                  void db.offsets.put({ transferId: headerRef.current.transfer_id, bytesTransferred: next, updatedAt: Date.now() });
                }
              }
            }).catch(async cause => {
              if (finished.current) return;
              setError(cause instanceof Error ? cause.message : "Receive failed."); setBusy(false); setAccepted(false);
              if (writer.current) await writer.current.abort().catch(() => undefined);
              writer.current = null;
              try { if (dc.readyState === "open") sendControl(dc, { type: "error", message: "Receiver could not save this file." }); } catch { /* disconnected */ }
            });
          };
          dc.onclose = () => {
            if (!finished.current) {
              void writer.current?.abort().catch(() => undefined);
              writer.current = null; setBusy(false); setAccepted(false);
              setError("Peer closed before transfer finished. Partial download discarded.");
            }
          };
        },
      });
      peer.current = conn;
      await conn.start();
    } catch (cause) {
      setBusy(false); setError(cause instanceof Error ? cause.message : "Code is invalid, expired, used, or rate-limited.");
    }
  };

  const accept = async () => {
    const current = headerRef.current;
    if (!current || !dataChannel.current || dataChannel.current.readyState !== "open" || accepted) return;
    setError("");
    try {
      // A picker must be opened on direct click; never automatically save a file.
      const handle = await openSavePicker(current.file_name);
      writer.current = await handle.createWritable();
      bytes.current = 0; lastAck.current = 0; startTime.current = performance.now();
      setAccepted(true);
      setStatus("Receiving chunks straight to disk; waiting for sender…");
      sendControl(dataChannel.current, { type: "ready", resume_from_byte: 0 });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not choose a save location."); }
  };

  const togglePause = () => {
    const dc = dataChannel.current;
    if (!dc || dc.readyState !== "open" || !accepted || complete) return;
    try {
      const next = !paused;
      sendControl(dc, { type: next ? "pause" : "resume" });
      setPaused(next); setStatus(next ? "Receiver paused; buffered chunks may still finish writing." : "Receiver resumed.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to pause transfer."); }
  };

  const decline = () => {
    try { if (dataChannel.current?.readyState === "open") sendControl(dataChannel.current, { type: "cancel" }); } catch { /* disconnected */ }
    void writer.current?.abort().catch(() => undefined); writer.current = null;
    peer.current?.close(); peer.current = null; setBusy(false); setAccepted(false); setHeader(null); headerRef.current = null;
    setStatus("Transfer declined or cancelled.");
  };

  return <div className="space-y-7">
    <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-violet-300">PHASE 1 · SPRINT 2</p><h1 className="mt-2 text-3xl font-bold">Receive a file</h1><p className="mt-2 text-white/55">Enter the sender's six-digit code. Downloads always require manual approval.</p></div>
    <Card className="max-w-2xl space-y-5 p-6 sm:p-8">
      <label className="block text-sm font-semibold" htmlFor="transfer-code">One-time transfer code</label>
      <input id="transfer-code" type="text" inputMode="numeric" autoComplete="off" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} disabled={busy}
        className="w-full rounded-xl border border-white/15 bg-white/5 p-4 text-center font-mono text-4xl tracking-[0.15em] outline-none focus:border-violet-300" placeholder="000000" />
      <Button className="w-full" onClick={() => void connect()} disabled={busy || code.length !== 6}>Connect to sender</Button>
      <p role="status" className="text-sm text-white/60">{status} {busy && `(${state})`}</p>
      {header && <div className="space-y-4 rounded-2xl border border-white/15 bg-white/5 p-5"><p className="break-all font-semibold">Incoming: {header.file_name}</p>
        {thumbnail&&<img alt="Sender's file preview" src={thumbnail} className="max-h-56 w-full rounded-xl object-contain"/>}
        <p className="text-xs text-white/50">{(header.file_size / (1024 * 1024)).toFixed(2)} MiB · {header.file_type}</p>
        {!accepted && !complete && busy && <div className="flex flex-wrap gap-3"><Button onClick={() => void accept()}><Download size={17}/> Choose save location & accept</Button><Button variant="outline" onClick={decline}>Decline</Button></div>}
        {accepted && !complete && <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={togglePause}>{paused ? <Play size={16}/> : <Pause size={16}/>} {paused ? "Resume" : "Pause"}</Button><Button variant="outline" onClick={decline}>Cancel</Button></div>}
        <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-cyan-400" style={{ width: `${header.file_size ? Math.min(100, written / header.file_size * 100) : complete ? 100 : 0}%` }}/></div>
        <p className="text-xs text-white/55">{written.toLocaleString()} / {header.file_size.toLocaleString()} bytes written · {(speed / (1024*1024)).toFixed(2)} MiB/s {speed > 0 && written < header.file_size && `· ETA ${Math.ceil((header.file_size - written)/speed)}s`} {complete && "· Saved"}</p></div>}
      {error && <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
      <p className="flex items-start gap-2 text-xs text-amber-200/80"><ShieldAlert size={18} className="shrink-0"/> The sender is not yet a trusted contact. Check the file and sender. Never open unexpected executable files.</p>
    </Card><Link className="text-sm text-violet-300 underline" href="/send">Send a file instead</Link>
    <p className="text-xs text-white/45">This version requires a compatible browser supporting File System Access API (usually desktop Chrome or Edge). Keep both devices online. The browser cannot guarantee a paused transfer survives a closed tab.</p>
  </div>;
}
