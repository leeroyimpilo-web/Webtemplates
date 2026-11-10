"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpFromLine, Copy, FileUp, Pause, Play, ShieldCheck, Wifi } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDevice } from "@/components/device-provider";
import { getSupabase } from "@/lib/supabase";
import { createTransferRoom, randomTransferCode } from "@/lib/transfer/rooms";
import { SupabaseRtcPeer, type PeerState } from "@/lib/transfer/rtc";
import { CHUNK_BYTES, TransferSender, parseControl, sendControl, type TransferControl } from "@/lib/transfer/stream";
import { db } from "@/lib/db";

const fmt = (n: number) => n < 1024 ? `${n} B` : `${(n / (1024 ** Math.floor(Math.log(n) / Math.log(1024)))).toFixed(1)} ${["B", "KiB", "MiB", "GiB", "TiB"][Math.floor(Math.log(n) / Math.log(1024))]}`;

export default function SendPage() {
  const { device } = useDevice();
  const input = useRef<HTMLInputElement>(null);
  const peer = useRef<SupabaseRtcPeer | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const abort = useRef<AbortController | null>(null);
  const session = useRef<TransferSender | null>(null);
  const selectedFile = useRef<File | null>(null);
  const transferId = useRef<string | null>(null);
  const finished = useRef(false);
  const active = useRef(false);
  const startTime = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("Select one file to send securely.");
  const [state, setState] = useState<PeerState>("waiting");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const [speed, setSpeed] = useState(0);

  useEffect(() => () => { abort.current?.abort(); peer.current?.close(); }, []);

  const send = async () => {
    if (!file || !device || busy) return;
    const client = getSupabase();
    if (!client) { setError("Supabase is not connected."); return; }
    setError(""); setBusy(true); setComplete(false); setProgress(0); setPaused(false); setSpeed(0);
    abort.current?.abort(); peer.current?.close();
    abort.current = new AbortController();
    selectedFile.current = file;
    session.current = null;
    active.current = false;
    finished.current = false;
    const invitation = randomTransferCode();
    try {
      const roomId = await createTransferRoom(client, device.id, invitation);
      setCode(invitation);
      setStatus("Waiting for your recipient to enter this code (valid 10 minutes).");
      const conn = new SupabaseRtcPeer({
        client, roomId, deviceId: device.id, role: "sender",
        onState: next => {
          setState(next);
          if (next === "disconnected" && !finished.current) {
            abort.current?.abort(); setBusy(false);
            setError("Connection lost. Restart the transfer using a fresh code; reconnect-resume belongs to Phase 3.");
          }
        },
        onChannel: dc => {
          channel.current = dc;
          dc.onopen = () => {
            const selected = selectedFile.current;
            if (!selected) return;
            const id = crypto.randomUUID();
            transferId.current = id;
            const header: TransferControl = {
              type: "header", protocol: 2, transfer_id: id,
              file_name: selected.name, file_size: selected.size,
              file_type: selected.type || "application/octet-stream",
              total_chunks: Math.ceil(selected.size / CHUNK_BYTES), chunk_size: 65536,
            };
            sendControl(dc, header);
            setStatus("Connected. Waiting for your recipient to manually choose a save location.");
          };
          dc.onmessage = (event: MessageEvent) => {
            if (typeof event.data !== "string") return;
            try {
              const message = parseControl(event.data);
              if (message.type === "ready" && message.resume_from_byte === 0 && selectedFile.current && abort.current && !active.current) {
                active.current = true;
                startTime.current = performance.now();
                const id = transferId.current;
                session.current = new TransferSender(dc, selectedFile.current, abort.current.signal,
                  bytes => {
                    setProgress(bytes);
                    const elapsed = Math.max(0.1, (performance.now() - startTime.current) / 1000);
                    setSpeed(bytes / elapsed);
                    if (id && (bytes % (1024 * 1024) === 0 || bytes === selectedFile.current?.size)) {
                      void db.offsets.put({ transferId: id, bytesTransferred: bytes, updatedAt: Date.now() });
                    }
                  }, value => setPaused(value));
                setStatus("Sending in 64 KiB chunks; progress shows confirmed disk writes.");
                void session.current.start().catch(cause => {
                  if (abort.current?.signal.aborted) return;
                  setError(cause instanceof Error ? cause.message : "Transfer failed.");
                  setBusy(false);
                });
              } else if (message.type === "ack" && session.current) {
                session.current.acknowledge(message.received_bytes);
              } else if (message.type === "pause") {
                session.current?.remotePause(true);
                setStatus("Recipient has paused receiving.");
              } else if (message.type === "resume") {
                session.current?.remotePause(false);
                setStatus("Sending resumed.");
              } else if (message.type === "finished") {
                if (!session.current || session.current.confirmedBytes !== selectedFile.current?.size) throw new Error("Unconfirmed completion.");
                finished.current = true; setComplete(true); setBusy(false); setPaused(false);
                setStatus("Recipient confirmed the file was saved successfully.");
                if (transferId.current) void db.offsets.delete(transferId.current);
              } else if (message.type === "cancel" || message.type === "error") {
                abort.current?.abort(); setBusy(false);
                setError(message.type === "error" ? message.message : "Recipient cancelled the transfer.");
              }
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Invalid receiver response.");
              abort.current?.abort(); setBusy(false);
            }
          };
          dc.onclose = () => {
            if (!finished.current && !abort.current?.signal.aborted) {
              abort.current?.abort(); setBusy(false);
              setError("Connection closed before receipt was confirmed.");
            }
          };
        },
      });
      peer.current = conn;
      await conn.start();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start transfer.");
      setBusy(false); setCode("");
    }
  };

  const togglePause = () => {
    if (!session.current || !busy) return;
    try {
      if (paused) { session.current.resume(); setStatus("Sending resumed."); }
      else { session.current.pause(); setStatus("Paused. The current transfer can resume while connected."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not change pause state."); }
  };

  const cancel = () => {
    try { if (channel.current?.readyState === "open") sendControl(channel.current, { type: "cancel" }); } catch { /* peer already closed */ }
    abort.current?.abort(); peer.current?.close(); peer.current = null;
    channel.current = null; session.current = null; active.current = false;
    setCode(""); setBusy(false); setPaused(false); setStatus("Transfer cancelled.");
  };

  return <div className="space-y-7">
    <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-violet-300">PHASE 1 · SPRINT 2</p>
      <h1 className="mt-2 text-3xl font-bold">Send a file</h1><p className="mt-2 text-white/55">Choose one file and share a one-time code. File bytes go device-to-device, not through Supabase.</p></div>
    <Card className="space-y-5 p-6 sm:p-8">
      <input ref={input} type="file" className="sr-only" aria-label="Select file to send" onChange={e => setFile(e.target.files?.[0] ?? null)} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) setFile(e.dataTransfer.files[0] ?? null); }}
        className="flex min-h-44 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-violet-300/25 bg-violet-400/5 px-4 text-center hover:border-violet-300/70 disabled:opacity-60">
        <ArrowUpFromLine className="mb-3 text-violet-300" size={34}/><span className="font-semibold">Drop or select a file</span>
        <span className="mt-2 text-xs text-white/45">Streams in 64 KiB chunks. Disk-write acknowledgements cap buffering.</span>
      </button>
      {file && <div className="flex items-center gap-3 rounded-xl bg-white/5 p-4"><FileUp size={20} className="text-violet-300"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.name}</p><p className="text-xs text-white/45">{fmt(file.size)}</p></div></div>}
      {!code ? <Button onClick={() => void send()} disabled={!file || busy} className="w-full"><Wifi size={17}/> Start secure transfer</Button> : <div className="space-y-3 rounded-2xl border border-violet-300/20 bg-violet-500/10 p-5 text-center">
        <p className="text-xs uppercase tracking-widest text-violet-200">One-time code · valid 10 minutes</p>
        <p className="font-mono text-5xl font-black tracking-[0.13em] text-white">{code}</p>
        <div className="flex justify-center gap-2"><Button variant="secondary" size="sm" onClick={() => void navigator.clipboard.writeText(code)}><Copy size={15}/> Copy</Button>
          <a className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold" href={`https://wa.me/?text=${encodeURIComponent(`Receive my PEND file using this 10-minute code: ${code}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></div>
        <p className="text-xs text-white/45">This does not establish trusted pairing.</p>
      </div>}
      <p role="status" className="text-sm text-white/60">{status} {code && <span className="text-violet-300">({state})</span>}</p>
      {file && code && <div className="space-y-2"><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-violet-400 transition-all" style={{ width: `${file.size === 0 ? complete ? 100 : 0 : Math.min(100, progress / file.size * 100)}%` }}/></div>
        <p className="text-xs text-white/55">{fmt(progress)} of {fmt(file.size)} confirmed received · {fmt(speed)}/s {speed > 0 && progress < file.size && `· ETA ${Math.ceil((file.size-progress)/speed)}s`} {complete && "· Saved"}</p></div>}
      {error && <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
      {code && <div className="flex flex-wrap gap-2">{busy && session.current && <Button variant="secondary" onClick={togglePause}>{paused ? <Play size={16}/> : <Pause size={16}/>} {paused ? "Resume" : "Pause"}</Button>}<Button variant="outline" onClick={cancel}>{busy ? "Cancel transfer" : "Clear transfer"}</Button></div>}
      <p className="flex items-center gap-2 text-xs text-white/45"><ShieldCheck size={15}/> WebRTC encrypts file content. Recipient must manually accept.</p>
    </Card>
    <p className="text-sm text-white/55">Receiving? <Link className="font-semibold text-violet-300 underline" href="/receive">Enter a transfer code</Link>.</p>
    <p className="text-xs text-amber-200/80">Pause/resume works only while the existing connection remains active. Reconnect-resume, offline pending, and trusted auto-accept belong to later phases. Without TURN, some networks cannot connect.</p>
  </div>;
}
