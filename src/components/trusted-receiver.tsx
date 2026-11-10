"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDevice } from "@/components/device-provider";
import { getSupabase } from "@/lib/supabase";
import { getPairingContacts, isTrustedLocally } from "@/lib/pairing";
import { db } from "@/lib/db";
import { getTrustedRoom, type TrustedTransferRoom } from "@/lib/transfer/trusted";
import { SupabaseRtcPeer } from "@/lib/transfer/rtc";
import { ACK_WINDOW_BYTES, CHUNK_BYTES, parseControl, safeFileName, sendControl, validateHeader, type TransferHeader } from "@/lib/transfer/stream";
import { assessAutoReceive } from "@/lib/transfer/auto-policy.mjs";

type Offer = { room: TrustedTransferRoom; reason: string };
type BrowserNetwork = Navigator & { connection?: { type?: string } };

async function privateInbox() {
  if (typeof navigator.storage?.getDirectory !== "function") throw new Error("Browser private Inbox storage is unavailable.");
  const home = await navigator.storage.getDirectory();
  return home.getDirectoryHandle("pend-inbox", { create: true });
}

/**
 * Receives trusted transfers only while this PWA is RUNNING. Browsers cannot
 * persist incoming WebRTC sockets or auto-write external Downloads in the background.
 * All bytes are saved to OPFS; never to Supabase Storage or memory-sized blobs.
 */
export function TrustedReceiver() {
  const { device } = useDevice();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const peer = useRef<SupabaseRtcPeer | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const activeRoom = useRef<TrustedTransferRoom | null>(null);
  const active = useRef(false);
  const handled = useRef(new Set<string>());
  const transferHeader = useRef<TransferHeader | null>(null);
  const writer = useRef<FileSystemWritableFileStream | null>(null);
  const folder = useRef<FileSystemDirectoryHandle | null>(null);
  const opfsName = useRef("");
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const written = useRef(0);
  const acknowledged = useRef(0);
  const finished = useRef(false);

  const abortLocal = useCallback(async () => {
    if (writer.current) { await writer.current.abort().catch(() => undefined); writer.current = null; }
    if (folder.current && opfsName.current) await folder.current.removeEntry(opfsName.current).catch(() => undefined);
    opfsName.current = ""; folder.current = null;
  }, []);

  const close = useCallback(() => {
    peer.current?.close(); peer.current = null; dcRef.current = null;
    active.current = false; activeRoom.current = null;
  }, []);

  const preservePartial = useCallback(async () => {
    if (!active.current) return;
    active.current = false;
    // Do not abort/truncate an OPFS file after a temporary network loss.
    try { await writeChain.current; } catch { /* Failed write is handled elsewhere. */ }
    if (writer.current) {
      await writer.current.close().catch(() => undefined);
      writer.current = null;
    }
    const room=activeRoom.current;
    if (room) {
      await db.offsets.put({transferId:room.transfer_id,bytesTransferred:written.current,updatedAt:Date.now()});
      handled.current.delete(room.transfer_id);
    }
    close();
    setStatus("Connection interrupted. Partial file saved; it can resume when the sender reconnects.");
  }, [close]);

  const fail = useCallback(async (message: string) => {
    setError(message); setStatus("");
    try { if (dcRef.current?.readyState === "open") sendControl(dcRef.current, { type: "error", message: "Receiver cancelled or could not save file." }); }
    catch { /* Already disconnected. */ }
    await abortLocal(); close(); setOffer(null);
  }, [abortLocal, close]);

  const beginWrite = useCallback(async () => {
    const room = activeRoom.current; const dc = dcRef.current;
    if (!room || !dc || dc.readyState !== "open" || writer.current || !transferHeader.current) return;
    try {
      // Recheck trusted authorization immediately before granting file writes.
      const client = getSupabase();
      if (!client || !device || !await getTrustedRoom(client, device.id, room.transfer_id)) {
        throw new Error("Trusted pairing expired or was revoked.");
      }
      folder.current = await privateInbox();
      opfsName.current = `${room.transfer_id}_${safeFileName(room.file_name)}`;
      const file = await folder.current.getFileHandle(opfsName.current, { create: true });
      const existing = await file.getFile();
      const size = transferHeader.current.file_size;
      if (existing.size > size) throw new Error("Saved partial exceeds authorized file length.");
      const resume = existing.size === size ? size : Math.floor(existing.size / CHUNK_BYTES) * CHUNK_BYTES;
      writer.current = await file.createWritable({ keepExistingData: true });
      if (resume !== existing.size) await writer.current.truncate(resume);
      await writer.current.seek(resume);
      written.current = resume; acknowledged.current = resume;
      setOffer(null); setStatus(`Receiving ${room.file_name} into private Inbox…`);
      sendControl(dc, { type: "ready", resume_from_byte: written.current });
    } catch (cause) {
      await fail(cause instanceof Error ? cause.message : "Inbox storage unavailable.");
    }
  }, [device, fail]);

  const checkIncoming = useCallback(async () => {
    if (!device || active.current || !device.is_available || !navigator.onLine) return;
    const client = getSupabase(); if (!client) return;
    try {
      const { data: waiting, error: queryError } = await client.from("transfers")
        .select("id,sender_device_id,receiver_device_id,status")
        .eq("receiver_device_id", device.id).eq("status", "connecting")
        .order("created_at", { ascending: true }).limit(8);
      if (queryError) throw queryError;
      const contacts = await getPairingContacts(client, device.id);
      for (const transfer of waiting ?? []) {
        if (active.current) break;
        if (handled.current.has(transfer.id)) continue;
        if (await db.inbox.get(transfer.id)) { handled.current.add(transfer.id); continue; }
        const contact = contacts.find(c => c.peer.id === transfer.sender_device_id && c.pairing.status === "paired");
        if (!contact || !await isTrustedLocally(contact.peer)) continue;
        const room = await getTrustedRoom(client, device.id, transfer.id);
        if (!room) { handled.current.add(transfer.id); continue; }
        active.current = true; handled.current.add(transfer.id); activeRoom.current = room;
        written.current = 0; acknowledged.current = 0;
        finished.current = false; transferHeader.current = null; writeChain.current = Promise.resolve();
        setStatus(`Connecting to trusted sender ${contact.peer.device_name}…`);
        const conn = new SupabaseRtcPeer({client,deviceId:device.id,roomId:room.room_id,role:"receiver",
          onState: state => {
            if (state === "disconnected" && !finished.current) {
              void preservePartial();
            }
          },
          onChannel: dc => {
            dcRef.current = dc; dc.binaryType = "arraybuffer";
            dc.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
              writeChain.current = writeChain.current.then(async () => {
                if (typeof event.data === "string") {
                  const msg = parseControl(event.data);
                  if (msg.type === "header") {
                    validateHeader(msg);
                    if (msg.transfer_id !== room.transfer_id || msg.file_name !== room.file_name ||
                        msg.file_size !== room.file_size || msg.file_type !== room.file_type || transferHeader.current) {
                      throw new Error("Sender metadata does not match authorized transfer.");
                    }
                    transferHeader.current = msg;
                    const network = (navigator as BrowserNetwork).connection?.type ?? "unknown";
                    const eligible = assessAutoReceive({paired:true,pinned:true,revoked:false,
                      available:device.is_available, fileName:msg.file_name,fileSize:msg.file_size,
                      wifiOnly:device.wifi_only && !device.download_on_data,networkType:network,online:navigator.onLine,
                      hasPrivateInbox:typeof navigator.storage?.getDirectory === "function"});
                    if (eligible.auto) void beginWrite();
                    else {setOffer({room,reason:eligible.reason});setStatus("Manual approval required by your safety settings.");}
                  } else if (msg.type === "end") {
                    if (!writer.current || !transferHeader.current || written.current !== transferHeader.current.file_size) {
                      throw new Error("File incomplete or not accepted.");
                    }
                    await writer.current.close(); writer.current=null;
                    const client = getSupabase();
                    if (!client || !device) throw new Error("Cannot confirm completed file to server.");
                    const result = await client.rpc("complete_received_transfer",{
                      p_receiver_device_id:device.id,p_transfer_id:room.transfer_id,
                    });
                    if (result.error || result.data !== true) throw result.error ?? new Error("Server rejected completed file.");
                    await db.inbox.put({transferId:room.transfer_id,fileName:room.file_name,
                      fileSize:written.current,senderId:room.sender_device_id,receivedAt:Date.now(),opfsName:opfsName.current});
                    await db.offsets.delete(room.transfer_id);
                    if (dc.readyState === "open") sendControl(dc,{type:"finished"});
                    finished.current=true; setProgress(100); setOffer(null); setStatus(`Saved ${room.file_name} to private Inbox.`);
                    // Keep connection alive briefly for sender's confirmation.
                    window.setTimeout(close,1500);
                  } else if (msg.type === "cancel" || msg.type === "error") {
                    throw new Error(msg.type === "error" ? "Sender reported an error." : "Sender cancelled transfer.");
                  }
                } else if (event.data instanceof ArrayBuffer) {
                  if (!writer.current || !transferHeader.current || finished.current) throw new Error("Unexpected incoming file bytes.");
                  if (event.data.byteLength === 0 || event.data.byteLength > CHUNK_BYTES ||
                      written.current + event.data.byteLength > transferHeader.current.file_size) throw new Error("Invalid chunk.");
                  await writer.current.write(event.data);
                  written.current += event.data.byteLength;
                  setProgress(transferHeader.current.file_size ? Math.min(100,100*written.current/transferHeader.current.file_size) : 100);
                  if (written.current - acknowledged.current >= ACK_WINDOW_BYTES || written.current === transferHeader.current.file_size) {
                    // A FileSystemWritableFileStream may buffer changes until close.
                    // Commit each 1 MiB checkpoint before ACK, so a killed browser
                    // can resume from durable OPFS bytes instead of losing progress.
                    await writer.current.close();
                    const committed = written.current;
                    const handle = await folder.current!.getFileHandle(opfsName.current);
                    writer.current = await handle.createWritable({ keepExistingData: true });
                    await writer.current.seek(committed);
                    acknowledged.current=committed;
                    if (dc.readyState === "open") sendControl(dc,{type:"ack",received_bytes:committed});
                    await db.offsets.put({transferId:room.transfer_id,bytesTransferred:written.current,updatedAt:Date.now()});
                    const client = getSupabase();
                    if (client && device) {
                      const result = await client.rpc("record_received_bytes",{
                        p_receiver_device_id:device.id,p_transfer_id:room.transfer_id,p_bytes:written.current,
                      });
                      if (result.error || result.data !== true) throw result.error ?? new Error("Server rejected progress update.");
                    }
                  }
                }
              }).catch(cause => { if (!finished.current) void fail(cause instanceof Error ? cause.message : "Could not receive file."); });
            };
          },
        });
        peer.current=conn;
        try {await conn.start();} catch (cause) {await fail(cause instanceof Error ? cause.message : "Could not join trusted transfer.");}
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not check trusted Inbox."); }
  }, [device, beginWrite, fail, close, preservePartial]);

  useEffect(() => {
    const timer = window.setInterval(() => void checkIncoming(), 5000);
    void checkIncoming();
    return () => { clearInterval(timer); if (active.current) void preservePartial(); else close(); };
  }, [checkIncoming, close, preservePartial]);

  if (!offer && !error && !status) return null;
  return <div className="fixed bottom-22 right-4 z-50 w-[min(23rem,calc(100vw-2rem))] rounded-2xl border border-violet-300/30 bg-[#172038] p-4 shadow-2xl shadow-black/60 md:bottom-6">
    <div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm font-bold"><ShieldCheck size={18} className="text-emerald-300"/> Trusted Inbox</p>
      {!active.current && <button type="button" onClick={()=>{setError("");setStatus("");}} aria-label="Dismiss Inbox message"><X size={17}/></button>}
    </div>
    {status && <p role="status" className="mt-2 break-words text-xs leading-5 text-white/65">{status}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p>}
    {offer && <div className="mt-3 space-y-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
      <p className="break-all text-sm font-semibold">{offer.room.file_name}</p>
      <p className="flex items-start gap-2 text-xs text-amber-200"><ShieldAlert size={16} className="shrink-0"/> {offer.reason}</p>
      <p className="text-xs text-white/60">{(offer.room.file_size/1048576).toFixed(1)} MiB · File stays in PEND Inbox and never opens automatically.</p>
      <div className="flex gap-2"><Button size="sm" onClick={()=>void beginWrite()}><Download size={15}/> Accept to Inbox</Button>
        <Button size="sm" variant="outline" onClick={()=>void (async()=>{
          const client=getSupabase();
          if(client&&device) await client.rpc("cancel_queued_transfer",{p_my_device_id:device.id,p_transfer_id:offer.room.transfer_id});
          await fail("Incoming transfer declined.");
        })()}>Decline</Button></div>
    </div>}
    {active.current && progress > 0 && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-cyan-300 transition-all" style={{width:`${progress}%`}}/></div>}
  </div>;
}
