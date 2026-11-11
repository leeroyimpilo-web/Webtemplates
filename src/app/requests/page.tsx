"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileQuestion, FileUp, Send, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDevice } from "@/components/device-provider";
import { getSupabase } from "@/lib/supabase";
import { getPairingContacts, isTrustedLocally, type PairingContact } from "@/lib/pairing";
import { queueFileResponse } from "@/lib/queue";

interface FileRequest {
  id: string; requester_device_id: string; target_device_id: string;
  message: string; status: "pending" | "fulfilled" | "declined"; created_at: string;
}

export default function RequestsPage() {
  const {device} = useDevice();
  const [contacts,setContacts] = useState<PairingContact[]>([]);
  const [requests,setRequests] = useState<FileRequest[]>([]);
  const [target,setTarget] = useState("");
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const [feedback,setFeedback] = useState("");
  const [error,setError] = useState("");
  const filePick = useRef<HTMLInputElement>(null);
  const replying = useRef<FileRequest|null>(null);

  const refresh = useCallback(async()=>{
    if(!device) return;
    const client=getSupabase();if(!client)return;
    const [items,pairs]=await Promise.all([
      client.from("transfer_requests").select("id,requester_device_id,target_device_id,message,status,created_at")
        .or(`requester_device_id.eq.${device.id},target_device_id.eq.${device.id}`)
        .order("created_at",{ascending:false}).limit(150),
      getPairingContacts(client,device.id),
    ]);
    if(items.error)throw items.error;
    setRequests((items.data ?? []) as FileRequest[]);
    const paired=pairs.filter(c=>c.pairing.status==='paired');
    const verified=(await Promise.all(paired.map(async p=>await isTrustedLocally(p.peer)?p:null)))
      .filter((x):x is PairingContact=>x!==null);
    setContacts(verified);
  },[device]);

  useEffect(()=>{void refresh().catch(e=>setError(String(e)));const timer=window.setInterval(()=>void refresh().catch(()=>undefined),10000);
    return ()=>clearInterval(timer);},[refresh]);

  const create = async()=>{
    const client=getSupabase();if(!client||!device||busy)return;
    setError("");setFeedback("");setBusy(true);
    try {
      const contact=contacts.find(c=>c.peer.id===target);
      if(!contact||!await isTrustedLocally(contact.peer)) throw new Error('Pairing is not verified.');
      const result=await client.rpc('create_file_request',{
        p_requester_device_id:device.id,p_target_device_id:target,p_message:message.trim(),
      });
      if(result.error)throw result.error;
      setMessage("");setFeedback(`Requested a file from ${contact.peer.device_name}.`);await refresh();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };

  const decline = async(item:FileRequest)=>{
    const client=getSupabase();if(!client||!device||busy)return;
    setBusy(true);setError("");
    try {
      const result=await client.rpc('decline_file_request',{p_target_device_id:device.id,p_request_id:item.id});
      if(result.error||result.data!==true)throw result.error??new Error('Request no longer pending');
      setFeedback('File request declined.');await refresh();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };

  const reply = async(file:File|null)=>{
    const item=replying.current;replying.current=null;
    if(!file||!item||!device||busy)return;
    const client=getSupabase();if(!client)return;
    setBusy(true);setError("");setFeedback("");
    try {
      const contact=contacts.find(c=>c.peer.id===item.requester_device_id);
      if(!contact||!await isTrustedLocally(contact.peer))throw new Error('Requester no longer trusted.');
      await queueFileResponse(client,device.id,item.id,item.requester_device_id,file);
      setFeedback(`Reply queued for ${contact.peer.device_name}. The file stays on your device until transferred.`);
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };

  const name=(id:string)=>contacts.find(c=>c.peer.id===id)?.peer.device_name??'Former contact';

  return <div className="space-y-7">
    <header><p className="text-xs font-bold tracking-[.2em] text-violet-300">PHASE 4 · REQUEST A FILE</p>
      <h1 className="mt-2 text-3xl font-bold">File requests</h1>
      <p className="mt-2 text-sm text-white/60">Ask a paired contact to send you a file. They choose the file themselves; requests never grant access to their storage.</p></header>
    <Card className="space-y-4 p-6"><h2 className="font-bold">New file request</h2>
      <select className="w-full rounded-xl border border-white/15 bg-[#1b2437] p-3 text-sm" value={target} onChange={e=>setTarget(e.target.value)} aria-label="Ask a paired contact">
        <option value="">Choose trusted contact</option>{contacts.map(c=><option key={c.peer.id} value={c.peer.id}>{c.peer.device_name}</option>)}
      </select>
      <textarea maxLength={500} rows={3} value={message} onChange={e=>setMessage(e.target.value)}
        placeholder="Please send me the video from Sunday" aria-label="Describe the file you need"
        className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-sm"/>
      <Button disabled={!target||!message.trim()||busy} onClick={()=>void create()}><Send size={16}/> Request file</Button>
      {!contacts.length&&<p className="text-sm text-amber-300">No paired contacts yet. <Link href="/contacts" className="underline">Pair a device</Link> first.</p>}
    </Card>
    {feedback&&<p role="status" className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200">{feedback}</p>}
    {error&&<p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
    <input type="file" className="sr-only" ref={filePick} aria-label="Choose file to fulfill request"
      onChange={e=>{void reply(e.target.files?.[0]??null);e.target.value='';}}/>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5"><h2 className="flex items-center gap-2 font-bold"><FileQuestion size={19}/> Requests to you</h2>
        {requests.filter(r=>r.target_device_id===device?.id).map(r=><div key={r.id} className="rounded-xl border border-white/10 p-4">
          <p className="text-sm font-semibold">{name(r.requester_device_id)}</p>
          <p className="mt-1 text-sm text-white/70">{r.message}</p>
          <p className="mt-2 text-xs text-white/45">{new Date(r.created_at).toLocaleString()} · {r.status}</p>
          {r.status==='pending'&&<div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={()=>{replying.current=r;filePick.current?.click();}}><FileUp size={15}/> Send file</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={()=>void decline(r)}><XCircle size={15}/> Decline</Button>
          </div>}
        </div>)}
        {!requests.some(r=>r.target_device_id===device?.id)&&<p className="text-sm text-white/50">No incoming requests.</p>}
      </Card>
      <Card className="space-y-3 p-5"><h2 className="font-bold">Requests you sent</h2>
        {requests.filter(r=>r.requester_device_id===device?.id).map(r=><div key={r.id} className="rounded-xl border border-white/10 p-4">
          <p className="font-semibold">{name(r.target_device_id)}</p><p className="mt-1 text-sm text-white/70">{r.message}</p>
          <p className="mt-2 text-xs text-white/45">{new Date(r.created_at).toLocaleString()} · {r.status}</p></div>)}
        {!requests.some(r=>r.requester_device_id===device?.id)&&<p className="text-sm text-white/50">You have not requested a file yet.</p>}
      </Card>
    </div>
  </div>;
}
