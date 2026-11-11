"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FolderOpen, HardDriveDownload, Search, ShieldCheck, Trash2, Files, Eye, Share2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { db, type InboxItem } from "@/lib/db";
import { useDevice } from "@/components/device-provider";
import { getSupabase } from "@/lib/supabase";
import { getPairingContacts } from "@/lib/pairing";
import { extractFolderPackage, readFolderManifest, type FolderEntry } from "@/lib/folder-package.mjs";

type PickerWindow = Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };

export default function InboxPage() {
  const { device } = useDevice();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [days, setDays] = useState("all");
  const [preview, setPreview] = useState<{url:string;type:string;name:string}|null>(null);
  const [folderView, setFolderView] = useState<{item:InboxItem; entries:FolderEntry[]; offset:number}|null>(null);
  const urls = useRef(new Set<string>());

  useEffect(() => {
    let alive=true;
    void db.inbox.orderBy("receivedAt").reverse().toArray().then(rows=>{if(alive){setItems(rows);setLoading(false);}})
      .catch(e=>{if(alive){setError(String(e));setLoading(false);}});
    if (device) {
      const client=getSupabase();
      if (client) void getPairingContacts(client,device.id).then(contacts=>{
        if(alive)setNames(Object.fromEntries(contacts.map(c=>[c.peer.id,c.peer.device_name])));
      }).catch(()=>undefined);
    }
    return ()=>{alive=false;for(const url of urls.current)URL.revokeObjectURL(url);urls.current.clear();};
  },[device]);

  const visible=useMemo(()=>items.filter(item=>{
    const q=search.toLowerCase().trim();
    const matched=!q || item.fileName.toLowerCase().includes(q) || (names[item.senderId]??item.senderId).toLowerCase().includes(q);
    const size= sizeFilter==='small'?item.fileSize<10*1024*1024:
      sizeFilter==='medium'?item.fileSize>=10*1024*1024&&item.fileSize<100*1024*1024:
        sizeFilter==='large'?item.fileSize>=100*1024*1024:true;
    const date=days==='all'||item.receivedAt>=Date.now()-Number(days)*86400000;
    return matched&&size&&date;
  }),[items,names,search,sizeFilter,days]);

  const fileBlob=async(item:InboxItem)=>{
    if(item.localBlob)return item.localBlob;
    if(!item.opfsName || typeof navigator.storage?.getDirectory!=="function")
      throw new Error("This file was saved outside PEND. Open it from the device folder.");
    const root=await navigator.storage.getDirectory();
    const folder=await root.getDirectoryHandle("pend-inbox");
    return (await folder.getFileHandle(item.opfsName)).getFile();
  };

  const download=async(item:InboxItem)=>{
    try {
      const blob=await fileBlob(item);
      const url=URL.createObjectURL(blob);
      const link=document.createElement("a");link.href=url;link.download=item.fileName;link.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  };

  const forget=async(item:InboxItem)=>{
    try {
      if(item.opfsName&&typeof navigator.storage?.getDirectory==="function") {
        const root=await navigator.storage.getDirectory();
        const folder=await root.getDirectoryHandle("pend-inbox");
        await folder.removeEntry(item.opfsName).catch(()=>undefined);
      }
      await db.inbox.delete(item.transferId);
      setItems(rows=>rows.filter(x=>x.transferId!==item.transferId));
      if(folderView?.item.transferId===item.transferId)setFolderView(null);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  };

  const showPreview=async(item:InboxItem)=>{
    try {
      const blob=await fileBlob(item);
      if(!blob.type.startsWith('image/')&&!blob.type.startsWith('video/')) {
        // OPFS File.type often omits MIME; use a conservative extension fallback.
        if(!/\.(png|jpe?g|gif|webp|mp4|webm)$/i.test(item.fileName))throw new Error('Preview unavailable for this file.');
      }
      const type=blob.type.startsWith('image/')||blob.type.startsWith('video/')?blob.type:
        /\.(png|jpe?g|gif|webp)$/i.test(item.fileName)?'image/png':'video/mp4';
      const url=URL.createObjectURL(blob);urls.current.add(url);
      setPreview({url,type,name:item.fileName});
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  };

  const inspectFolder=async(item:InboxItem)=>{
    try {const content=await fileBlob(item);const manifest=await readFolderManifest(content);
      setFolderView({item,entries:manifest.entries,offset:manifest.dataOffset});setError("");
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  };

  const extract=async(item:InboxItem)=>{
    setMessage("");setError("");
    try {
      // Browser user activation is needed for directory picker. Request it BEFORE await fileBlob.
      const picker=(window as PickerWindow).showDirectoryPicker;
      if(!picker)throw new Error('Folder extraction to a chosen directory requires Chrome or Edge desktop. You can still download the .pendpack file.');
      const destination=await picker();
      const count=await extractFolderPackage(await fileBlob(item),destination);
      setMessage(`Extracted ${count} files with their original folder paths.`);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  };

  const share=async(item:InboxItem)=>{
    try {
      const blob=await fileBlob(item);
      const file=new File([blob],item.fileName,{type:blob.type||'application/octet-stream'});
      if(!navigator.share||!navigator.canShare?.({files:[file]}))throw new Error('Your browser cannot share this file. Download it instead.');
      await navigator.share({files:[file],title:item.fileName});
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  };

  return <div className="space-y-7">
    <header><p className="text-xs font-bold uppercase tracking-[0.25em] text-violet-300">PHASE 4 · LOCAL INBOX</p>
      <h1 className="mt-2 text-3xl font-bold">Inbox</h1>
      <p className="mt-2 text-sm text-white/50">Received files stay in this browser's private storage until you choose to open, download or share them.</p>
    </header>
    <Card className="grid gap-3 p-4 sm:grid-cols-3">
      <label className="relative sm:col-span-1"><Search className="absolute left-3 top-3.5 text-white/40" size={17}/>
        <input value={search} onChange={e=>setSearch(e.target.value)} aria-label="Search files or senders" placeholder="Search file or sender"
          className="w-full rounded-xl border border-white/15 bg-white/5 py-3 pl-10 pr-3 text-sm"/></label>
      <select aria-label="Filter by size" value={sizeFilter} onChange={e=>setSizeFilter(e.target.value)} className="rounded-xl border border-white/15 bg-[#1b2437] px-3 py-3 text-sm">
        <option value="all">All file sizes</option><option value="small">Under 10 MiB</option>
        <option value="medium">10–100 MiB</option><option value="large">100 MiB or larger</option></select>
      <select aria-label="Filter by date" value={days} onChange={e=>setDays(e.target.value)} className="rounded-xl border border-white/15 bg-[#1b2437] px-3 py-3 text-sm">
        <option value="all">Any date</option><option value="7">Past 7 days</option><option value="30">Past 30 days</option></select>
    </Card>
    {error&&<p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
    {message&&<p role="status" className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</p>}
    {visible.length?<div className="space-y-3">{visible.map(item=><Card key={item.transferId} className="flex flex-wrap items-center gap-3 p-5">
      <div className="rounded-xl bg-violet-400/10 p-3 text-violet-300"><HardDriveDownload size={20}/></div>
      <div className="min-w-0 flex-1"><p className="break-all font-semibold">{item.fileName}</p>
        <p className="mt-1 text-xs text-white/50">{(item.fileSize/1048576).toFixed(2)} MiB · {new Date(item.receivedAt).toLocaleString()} · From {names[item.senderId]??item.senderId}</p></div>
      <div className="flex flex-wrap gap-2">
        {item.fileName.endsWith('.pendpack')&&<Button size="sm" variant="secondary" onClick={()=>void inspectFolder(item)}><Files size={15}/> Files</Button>}
        {item.fileName.endsWith('.pendpack')&&<Button size="sm" variant="secondary" onClick={()=>void extract(item)}><FolderOpen size={15}/> Extract</Button>}
        {/\.(png|jpe?g|gif|webp|mp4|webm)$/i.test(item.fileName)&&<Button size="sm" variant="secondary" onClick={()=>void showPreview(item)}><Eye size={15}/> Preview</Button>}
        <Button size="sm" onClick={()=>void download(item)}><HardDriveDownload size={15}/> Download</Button>
        <Button size="sm" variant="outline" onClick={()=>void share(item)}><Share2 size={15}/> Share</Button>
        <Button size="sm" variant="outline" onClick={()=>void forget(item)}><Trash2 size={15}/> Delete</Button>
      </div></Card>)}</div>:<Card className="flex min-h-60 flex-col items-center justify-center p-8 text-center"><FolderOpen size={36} className="mb-4 text-cyan-300"/>
      <h2 className="font-semibold">{loading?'Reading Inbox…':items.length?'No files match these filters':'No received files yet'}</h2>
      <Link className="mt-5 rounded-xl bg-violet-500 px-5 py-3 text-sm font-bold" href="/receive">Receive a file</Link></Card>}
    {folderView&&<Card className="space-y-3 p-5"><h2 className="font-bold">Folder contents — {folderView.item.fileName}</h2>
      <p className="text-xs text-white/50">{folderView.entries.length} files; paths remain intact when extracted with the directory picker.</p>
      <div className="max-h-64 space-y-2 overflow-y-auto">{folderView.entries.map(entry=><p key={entry.path} className="break-all rounded-lg bg-white/5 px-3 py-2 text-sm">{entry.path} <span className="text-white/40">({entry.size} bytes)</span></p>)}</div>
      <Button variant="outline" onClick={()=>setFolderView(null)}>Close</Button></Card>}
    {preview&&<Card className="space-y-3 p-5"><h2 className="font-bold">Preview · {preview.name}</h2>
      {preview.type.startsWith('image/')?<img alt={`Preview of ${preview.name}`} src={preview.url} className="max-h-96 max-w-full rounded-xl object-contain"/>:
        <video src={preview.url} controls className="max-h-96 w-full rounded-xl" preload="metadata"/>}
      <Button variant="outline" onClick={()=>{URL.revokeObjectURL(preview.url);urls.current.delete(preview.url);setPreview(null);}}>Close preview</Button></Card>}
    <p className="flex items-center gap-2 text-xs text-white/50"><ShieldCheck size={14}/> Private files never auto-open; deleting removes PEND's stored copy.</p>
  </div>;
}
