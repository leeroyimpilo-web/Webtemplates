"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useDevice } from "@/components/device-provider";
import { getSupabase } from "@/lib/supabase";
import { cancelPending, getOutgoingQueue, type QueueRow } from "@/lib/queue";
import { getPairingContacts } from "@/lib/pairing";
import { derivePresence } from "@/lib/presence.mjs";
import { db } from "@/lib/db";

interface DisplayRow extends QueueRow {recipient:string;detail:string;localSource:boolean}
export function PendingPanel(){
  const {device}=useDevice();
  const [outgoing,setOutgoing]=useState<DisplayRow[]>([]);
  const [incoming,setIncoming]=useState<QueueRow[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{
    if(!device)return;
    const client=getSupabase();if(!client)return;
    try{
      const [rows,contactRows,local,waiting]=await Promise.all([
        getOutgoingQueue(client,device.id),getPairingContacts(client,device.id),db.pending.toArray(),
        client.from("transfers").select("id,sender_device_id,receiver_device_id,file_name,file_size,file_type,status,bytes_transferred,expires_at,created_at")
          .eq("receiver_device_id",device.id).in("status",["pending","connecting","transferring","paused"])
          .order("created_at",{ascending:false}).limit(100),
      ]);
      if(waiting.error)throw waiting.error;
      const sources=new Set(local.filter(x=>!!x.source).map(x=>x.transferId));
      const peers=new Map(contactRows.map(c=>[c.peer.id,c.peer]));
      const selected=rows.filter(r=>["pending","connecting","transferring","paused"].includes(r.status)).map(row=>{
        const peer=peers.get(row.receiver_device_id);
        const presence=peer?derivePresence(peer):{state:"offline",label:"Offline"};
        const localSource=sources.has(row.id);
        return {...row,recipient:peer?.device_name??"Unknown device",
          detail:!localSource?"Original file missing from this browser — select again or cancel":
            row.status==="connecting"||row.status==="transferring"?"Connecting / transferring in foreground":
              presence.state==="available"?"Queued · attempting to connect":`Pending · ${presence.label}`,
          localSource};
      });
      setOutgoing(selected);setIncoming((waiting.data??[]) as QueueRow[]);
      setError("");
    }catch(err){setError(err instanceof Error?err.message:"Could not load queue");}
  },[device]);
  useEffect(()=>{
    void load();const timer=window.setInterval(()=>void load(),5000);
    const refresh=()=>void load();window.addEventListener("pend:queue-changed",refresh);
    return()=>{window.clearInterval(timer);window.removeEventListener("pend:queue-changed",refresh);};
  },[load]);
  const remove=async(id:string)=>{
    const client=getSupabase();if(!client||!device)return;
    setBusy(true);
    try{await cancelPending(client,device.id,id);await load();}
    catch(err){setError(err instanceof Error?err.message:"Could not cancel");}
    finally{setBusy(false);}
  };
  return <section className="space-y-3" aria-label="Pending transfers">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Pending & active transfers</h2>
      <p className="mt-1 text-xs text-white/45">Sender files remain on this browser only. Both PEND apps must be open to transfer.</p></div>
      <Button size="sm" variant="secondary" onClick={()=>{window.dispatchEvent(new Event("pend:queue-changed"));void load();}}><RefreshCw size={15}/> Resume all eligible</Button>
    </div>
    {error&&<p role="alert" className="text-xs text-rose-300">{error}</p>}
    {outgoing.length===0&&incoming.length===0?<Card className="p-5 text-sm text-white/50">No pending files. Send something to a paired contact, even while they are offline.</Card>:null}
    {outgoing.map(row=><Card key={row.id} className="flex flex-wrap items-center gap-3 p-4">
      <Clock size={20} className="shrink-0 text-amber-300"/><div className="min-w-0 flex-1"><p className="break-all text-sm font-semibold">{row.file_name}</p>
        <p className="mt-1 text-xs text-white/50">To {row.recipient} · {row.detail}</p>
        <p className="mt-1 text-xs text-white/35">{(row.file_size/1048576).toFixed(1)} MiB · {row.status} · {(100*row.bytes_transferred/Math.max(1,row.file_size)).toFixed(0)}% saved</p></div>
      <Button size="sm" variant="outline" disabled={busy} onClick={()=>void remove(row.id)}><XCircle size={15}/> Cancel</Button>
    </Card>)}
    {incoming.map(row=><Card key={row.id} className="flex items-center gap-3 p-4"><Clock size={19} className="text-cyan-300"/>
      <div><p className="break-all text-sm font-medium">Incoming: {row.file_name}</p>
        <p className="text-xs text-white/50">{row.status==="pending"?"Waiting for sender / network / availability": "Transfer connection requested"} · {(row.file_size/1048576).toFixed(1)} MiB</p></div>
    </Card>)}
  </section>;
}
