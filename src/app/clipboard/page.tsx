"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClipboardCopy, CopyCheck, LockKeyhole, Send } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useDevice } from "@/components/device-provider";
import { getSupabase } from "@/lib/supabase";
import { getPairingContacts, isTrustedLocally, type PairingContact } from "@/lib/pairing";
import { getOrCreateIdentity } from "@/lib/identity";
import { clipboardTopic, decryptClipboard, encryptClipboard,
  type ClipboardEnvelope, CLIPBOARD_LIMIT_BYTES } from "@/lib/clipboard-crypto.mjs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ClipboardPage() {
  const {device}=useDevice();
  const [contacts,setContacts]=useState<PairingContact[]>([]);
  const [target,setTarget]=useState("");
  const [text,setText]=useState("");
  const [received,setReceived]=useState("");
  const [connection,setConnection]=useState("Select a trusted contact.");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [sending,setSending]=useState(false);
  const channel=useRef<RealtimeChannel|null>(null);
  const seen=useRef(new Set<string>());

  useEffect(()=>{
    if(!device)return;
    const client=getSupabase();if(!client)return;
    let live=true;
    void getPairingContacts(client,device.id).then(async rows=>{
      const paired=rows.filter(c=>c.pairing.status==='paired');
      const verified=(await Promise.all(paired.map(async c=>await isTrustedLocally(c.peer)?c:null)))
        .filter((c):c is PairingContact=>c!==null);
      if(live)setContacts(verified);
    }).catch(cause=>{if(live)setError(String(cause));});
    return ()=>{live=false;};
  },[device]);

  useEffect(()=>{
    const client=getSupabase(), peer=contacts.find(c=>c.peer.id===target);
    if(!client||!device||!peer){setConnection("Select a trusted contact.");return;}
    let live=true;
    let active:RealtimeChannel|null=null;
    const start=async()=>{
      if(!await isTrustedLocally(peer.peer))throw new Error("Peer fingerprint is no longer trusted.");
      const { data:{session} }=await client.auth.getSession();
      if(!session)throw new Error("Sign in before sharing clipboard text.");
      client.realtime.setAuth(session.access_token);
      if(!live)return;
      const topic=clipboardTopic(device.id,peer.peer.id);
      const ch=client.channel(topic,{config:{broadcast:{self:false}}});
      active=ch;channel.current=ch;
      ch.on('broadcast',{event:'encrypted-clipboard'},({payload})=>{
        void (async()=>{
          const box=payload as ClipboardEnvelope;
          if(!live||box?.sender!==peer.peer.id||box?.receiver!==device.id||seen.current.has(box.id))return;
          const latest=await getPairingContacts(client,device.id);
          if(!latest.some(c=>c.peer.id===peer.peer.id&&c.pairing.status==='paired') ||
             !await isTrustedLocally(peer.peer))throw new Error('Peer pairing revoked or local identity changed.');
          const identity=await getOrCreateIdentity();
          const value=await decryptClipboard(identity.privateKey,peer.peer.public_key,box,peer.peer.id,device.id);
          seen.current.add(box.id);
          if(live){setReceived(value);setNotice(`Encrypted text received from ${peer.peer.device_name}. Choose Copy to use it.`);}
        })().catch(cause=>{if(live)setError(cause instanceof Error?cause.message:'Could not verify clipboard message.');});
      });
      ch.subscribe(status=>{
        if(live)setConnection(status==='SUBSCRIBED'?`Connected securely to ${peer.peer.device_name}.`:`Realtime: ${status}`);
      });
    };
    void start().catch(e=>{if(live)setError(String(e));});
    return ()=>{live=false;if(channel.current===active)channel.current=null;if(active)void client.removeChannel(active);};
  },[contacts,device,target]);

  const send=useCallback(async()=>{
    const client=getSupabase(),peer=contacts.find(c=>c.peer.id===target),ch=channel.current;
    if(!client||!device||!peer||!ch||sending)return;
    setSending(true);setError("");setNotice("");
    try {
      const latest=await getPairingContacts(client,device.id);
      if(!latest.some(c=>c.peer.id===peer.peer.id&&c.pairing.status==='paired') ||
         !await isTrustedLocally(peer.peer))throw new Error('Pairing revoked; do not share clipboard text.');
      const identity=await getOrCreateIdentity();
      const box=await encryptClipboard(identity.privateKey,peer.peer.public_key,text,device.id,peer.peer.id);
      const result=await ch.send({type:'broadcast',event:'encrypted-clipboard',payload:box});
      if(result!=='ok')throw new Error(`Could not deliver encrypted message: ${result}`);
      setNotice('Encrypted clipboard text sent. The other PEND tab must be open to receive it.');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setSending(false);}
  },[contacts,device,target,sending,text]);

  const paste=async()=>{
    try {setText(await navigator.clipboard.readText());setError("");}
    catch{setError('Clipboard read permission denied. Paste your text manually.');}
  };
  const copy=async()=>{
    try {await navigator.clipboard.writeText(received);setNotice('Text copied to your clipboard.');}
    catch{setError('Clipboard write permission denied. Select the received text to copy it manually.');}
  };

  return <div className="space-y-7">
    <header><p className="text-xs font-bold tracking-[.2em] text-violet-300">PHASE 4 · ENCRYPTED CLIPBOARD</p>
      <h1 className="mt-2 text-3xl font-bold">Cross-device clipboard</h1>
      <p className="mt-2 text-sm text-white/60">Share a short text snippet with a mutually paired device. Only ciphertext travels through Supabase Realtime.</p></header>
    <Card className="space-y-4 p-6"><label className="block text-sm font-semibold" htmlFor="clipboard-peer">Send to trusted contact</label>
      <select id="clipboard-peer" value={target} onChange={e=>{setTarget(e.target.value);setReceived('');}}
        className="w-full rounded-xl border border-white/15 bg-[#1b2437] p-3 text-sm">
        <option value="">Choose contact</option>{contacts.map(c=><option key={c.peer.id} value={c.peer.id}>{c.peer.device_name}</option>)}
      </select>
      <p role="status" className="flex items-center gap-2 text-xs text-white/50"><LockKeyhole size={16}/> {connection}</p>
      <label className="block text-sm font-semibold" htmlFor="clipboard-content">Text or link (max 10 KiB)</label>
      <textarea id="clipboard-content" rows={4} className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-sm"
        placeholder="Paste text or a link here" value={text} onChange={e=>setText(e.target.value)}/>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={()=>void paste()}><ClipboardCopy size={16}/> Paste from device</Button>
        <Button disabled={!target||!text||sending||new TextEncoder().encode(text).length>CLIPBOARD_LIMIT_BYTES}
          onClick={()=>void send()}><Send size={16}/> {sending?'Sending…':'Send encrypted text'}</Button>
      </div>
      <p className="text-xs text-white/40">{new TextEncoder().encode(text).length} / {CLIPBOARD_LIMIT_BYTES} bytes. Messages are ephemeral, never stored in a database.</p>
    </Card>
    {received&&<Card className="space-y-3 p-6"><h2 className="font-semibold">Received text</h2>
      <textarea rows={4} readOnly value={received} className="w-full rounded-xl bg-white/5 p-3 text-sm" aria-label="Received clipboard message"/>
      <Button onClick={()=>void copy()}><CopyCheck size={16}/> Copy to clipboard</Button>
    </Card>}
    {notice&&<p role="status" className="rounded-xl bg-emerald-400/10 p-3 text-sm text-emerald-200">{notice}</p>}
    {error&&<p role="alert" className="rounded-xl bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}
    {!contacts.length&&<p className="text-sm text-amber-200">No verified contacts. <Link className="underline" href="/contacts">Pair another device</Link> before using the clipboard.</p>}
    <p className="text-xs text-white/45">Both apps must be open. Receipt never runs commands or automatically copies text into your system clipboard.</p>
  </div>;
}
