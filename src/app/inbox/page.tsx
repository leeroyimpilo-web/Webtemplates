"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderOpen, HardDriveDownload, ShieldCheck, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { db, type InboxItem } from "@/lib/db";

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void db.inbox.orderBy("receivedAt").reverse().toArray().then(rows => {
      if (alive) { setItems(rows); setLoading(false); }
    }).catch(cause => { if (alive) { setLoading(false); setError(String(cause)); } });
    return () => { alive = false; };
  }, []);
  const forget = async (transferId: string) => {
    await db.inbox.delete(transferId);
    setItems(list => list.filter(item => item.transferId !== transferId));
  };
  return <div className="space-y-7">
    <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-violet-300">LOCAL DEVICE HISTORY</p><h1 className="mt-2 text-3xl font-bold">Inbox</h1>
      <p className="mt-2 text-white/50">Completed downloads you saved on this device. PEND stores only their metadata here.</p></div>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {items.length ? <div className="space-y-3">{items.map(item => <Card key={item.transferId} className="flex flex-wrap items-center gap-4 p-5">
      <div className="rounded-xl bg-violet-400/10 p-3 text-violet-300"><HardDriveDownload size={20}/></div>
      <div className="min-w-0 flex-1"><p className="break-all font-semibold">{item.fileName}</p><p className="text-xs text-white/50">{(item.fileSize / 1024 / 1024).toFixed(2)} MiB · {new Date(item.receivedAt).toLocaleString()}</p>
        <p className="mt-1 text-xs text-white/40">Already saved using your browser’s file picker. Open from your device’s chosen folder.</p></div>
      <Button variant="outline" size="sm" onClick={() => void forget(item.transferId)}><Trash2 size={15}/> Remove history</Button>
    </Card>)}</div> : <Card className="flex min-h-72 flex-col items-center justify-center p-8 text-center"><FolderOpen className="mb-5 text-cyan-300" size={36}/>
      <h2 className="text-lg font-semibold">{loading ? "Reading local history…" : "No completed downloads yet"}</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-white/45">Enter the sender’s one-time six-digit code. Incoming files are reviewed and written directly to your chosen folder.</p>
      <Link href="/receive" className="mt-6 inline-flex rounded-xl bg-violet-500 px-5 py-3 text-sm font-bold text-white">Enter a receive code</Link></Card>}
    <p className="flex items-center gap-2 text-xs text-white/50"><ShieldCheck size={14}/> Removing a history entry does not delete a file saved outside your browser.</p>
  </div>;
}
