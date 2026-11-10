"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpFromLine, Copy, FileUp, ShieldCheck, Wifi } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDevice } from "@/components/device-provider";
import { getSupabase } from "@/lib/supabase";
import { createTransferRoom, randomTransferCode } from "@/lib/transfer/rooms";
import { SupabaseRtcPeer, type PeerState } from "@/lib/transfer/rtc";
import { CHUNK_BYTES, sendFileStream, type TransferControl } from "@/lib/transfer/stream";

function fmt(b: number) { return b < 1024 ? `${b} B` : `${(b / 1024 ** Math.floor(Math.log(b) / Math.log(1024))).toFixed(1)} ${["B", "KiB", "MiB", "GiB", "TiB"][Math.floor(Math.log(b) / Math.log(1024))] ?? "bytes"}`; }

export default function SendPage() {
  const { device } = useDevice();
  const input = useRef<HTMLInputElement>(null);
  const peer = useRef<SupabaseRtcPeer | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const abort = useRef<AbortController | null>(null);
  const selectedFile = useRef<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("Select one file to send directly.");
  const [state, setState] = useState<PeerState>("waiting");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => { abort.current?.abort(); peer.current?.close(); }, []);

  const send = async () => {
    if (!file || !device) return;
    const client = getSupabase();
    if (!client) { setError("Supabase is not connected."); return; }
    setError(""); setBusy(true); setComplete(false); setProgress(0);
    abort.current?.abort(); peer.current?.close();
    abort.current = new AbortController();
    selectedFile.current = file;
    const inviteCode = randomTransferCode();
    try {
      const roomId = await createTransferRoom(client, device.id, inviteCode);
      setCode(inviteCode);
      setStatus("Waiting for the other device to enter this code.");
      const connection = new SupabaseRtcPeer({
        client, roomId, deviceId: device.id, role: "sender",
        onState: (next) => { setState(next); if (next === "disconnected") setStatus("Disconnected. Restart to retry (resume is in the next sprint)."); },
        onChannel: (dc) => {
          channel.current = dc;
          dc.onopen = () => {
            const selected = selectedFile.current;
            if (!selected) return;
            const header: TransferControl = {
              type: "header", transfer_id: crypto.randomUUID(), file_name: selected.name,
              file_size: selected.size, file_type: selected.type || "application/octet-stream",
              total_chunks: Math.ceil(selected.size / CHUNK_BYTES),
            };
            dc.send(JSON.stringify(header));
            setStatus("Receiver connected. Waiting for them to choose a save location.");
          };
          dc.onmessage = (e: MessageEvent<string>) => {
            if (typeof e.data !== "string") return;
            try {
              const message = JSON.parse(e.data) as TransferControl;
              if (message.type === "ready" && selectedFile.current && abort.current) {
                setStatus("Sending securely over WebRTC…");
                void sendFileStream(dc, selectedFile.current, abort.current.signal, (bytes) => setProgress(bytes)).catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : "File streaming failed.");
                  setBusy(false);
                });
              } else if (message.type === "finished") {
                setComplete(true); setBusy(false); setStatus("File received and saved by the other device.");
              } else if (message.type === "cancel") {
                abort.current?.abort(); setBusy(false); setError("Receiver cancelled the transfer.");
              }
            } catch { setError("Invalid receiver response."); }
          };
          dc.onclose = () => { if (!complete) setStatus("Connection closed. Start a new transfer to retry."); };
        },
      });
      peer.current = connection;
      await connection.start();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start a transfer.");
      setBusy(false); setCode("");
    }
  };

  const cancel = () => {
    if (channel.current?.readyState === "open") channel.current.send(JSON.stringify({ type: "cancel" } satisfies TransferControl));
    abort.current?.abort(); peer.current?.close(); peer.current = null;
    channel.current = null; setCode(""); setBusy(false); setStatus("Transfer cancelled.");
  };

  return <div className="space-y-7">
    <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-violet-300">PHASE 1 · DIRECT TRANSFER</p>
      <h1 className="mt-2 text-3xl font-bold">Send a file</h1><p className="mt-2 text-white/55">Choose one file and share a one-time code. Nothing uploads to Supabase.</p></div>
    <Card className="space-y-5 p-6 sm:p-8">
      <input ref={input} type="file" className="sr-only" aria-label="Select file to send" onChange={e => { const chosen = e.target.files?.[0] ?? null; setFile(chosen); }} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) setFile(e.dataTransfer.files[0] ?? null); }}
        className="flex min-h-44 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-violet-300/25 bg-violet-400/5 px-4 text-center hover:border-violet-300/70 disabled:opacity-60">
        <ArrowUpFromLine className="mb-3 text-violet-300" size={34}/><span className="font-semibold">Drop or select a file</span>
        <span className="mt-2 text-xs text-white/45">Streams in 64 KiB chunks. No cloud upload.</span>
      </button>
      {file && <div className="flex items-center gap-3 rounded-xl bg-white/5 p-4"><FileUp size={20} className="text-violet-300"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.name}</p><p className="text-xs text-white/45">{fmt(file.size)}</p></div></div>}
      {!code ? <Button onClick={() => void send()} disabled={!file || busy} className="w-full"><Wifi size={17}/> Start secure transfer</Button> : <div className="space-y-3 rounded-2xl border border-violet-300/20 bg-violet-500/10 p-5 text-center">
        <p className="text-xs uppercase tracking-widest text-violet-200">One-time transfer code (10 minutes)</p>
        <p className="font-mono text-5xl font-black tracking-[0.13em] text-white">{code}</p>
        <div className="flex justify-center gap-2"><Button variant="secondary" size="sm" onClick={() => void navigator.clipboard.writeText(code)}><Copy size={15}/> Copy code</Button>
          <a className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold" href={`https://wa.me/?text=${encodeURIComponent(`Receive my PEND file using this 10-minute transfer code: ${code}`)}`} target="_blank" rel="noopener noreferrer">Share via WhatsApp</a></div>
        <p className="text-xs text-white/45">This code does not create a trusted pairing.</p>
      </div>}
      <div role="status" className="text-sm text-white/60">{status} {code && <span className="text-violet-300">({state})</span>}</div>
      {file && code && <div className="space-y-2"><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-violet-400 transition-all" style={{ width: `${file.size === 0 ? 100 : Math.min(100, (progress / file.size) * 100)}%` }}/></div><p className="text-xs text-white/55">{fmt(progress)} of {fmt(file.size)} transmitted {complete ? "· Confirmed received" : ""}</p></div>}
      {error && <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
      {code && <Button variant="outline" onClick={cancel}>Cancel transfer</Button>}
      <p className="flex items-center gap-2 text-xs text-white/45"><ShieldCheck size={15}/> WebRTC encrypts file traffic. Recipient must manually accept.</p>
    </Card>
    <p className="text-sm text-white/55">Receiving instead? <Link className="font-semibold text-violet-300 underline" href="/receive">Enter a transfer code</Link>.</p>
    <p className="text-xs text-amber-200/80">Sprint 1 limitations: one file per session; no pause/resume, trusted pairing, large-file Safari support or guaranteed NAT traversal without TURN. A manual recipient must keep both tabs open.</p>
  </div>;
}
