"use client";
import { useRef, useState } from "react";
import { ArrowUpFromLine, File, FilePlus2, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** unit).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][unit] ?? "PB"}`;
}
export default function SendPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  return <div className="space-y-7"><div><p className="text-xs font-bold uppercase tracking-[0.25em] text-violet-300">DIRECT DEVICE TRANSFER</p><h1 className="mt-2 text-3xl font-bold">Send files</h1><p className="mt-2 text-white/50">No file bytes leave this browser during Phase 0.</p></div>
    <Card className="p-5 sm:p-7"><input ref={inputRef} type="file" multiple className="sr-only" aria-label="Choose files" onChange={(e) => setFiles(Array.from(e.target.files ?? []))}/><button type="button" onClick={() => inputRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {e.preventDefault();setFiles(Array.from(e.dataTransfer.files));}}
      className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/20 bg-[#101526] px-6 py-15 text-center transition hover:border-violet-300/70 hover:bg-violet-400/5"><span className="mb-5 grid size-15 place-items-center rounded-2xl bg-violet-500/15 text-violet-300"><ArrowUpFromLine size={27}/></span><span className="font-semibold">Drop files here, or click to browse</span><span className="mt-2 text-sm text-white/45">File selection preview only · No upload</span></button>
      {files.length > 0 && <div className="mt-6 space-y-2"><h2 className="text-sm font-bold">Selected files ({files.length})</h2>{files.map((file, i) => <div key={`${file.name}-${i}`} className="flex items-center gap-3 rounded-xl bg-white/5 p-3"><File size={18} className="shrink-0 text-violet-300"/><span className="min-w-0 flex-1 truncate text-sm">{file.name}</span><span className="text-xs text-white/45">{formatBytes(file.size)}</span></div>)}<Button variant="secondary" onClick={() => {setFiles([]);if(inputRef.current) inputRef.current.value="";}}>Clear selection</Button></div>}
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-300/15 bg-amber-300/5 p-4 text-sm text-white/65"><Info size={18} className="mt-0.5 shrink-0 text-amber-300"/><p>Sending is intentionally disabled until Phase 1. PeerJS, signaling, chunked streaming and progress are not implemented in this scaffold.</p></div>
      <div className="mt-5 flex justify-end"><Button disabled><FilePlus2 size={17}/> Select receiver & send (Phase 1)</Button></div></Card></div>;
}
