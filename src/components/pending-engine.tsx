"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CloudOff, X } from "lucide-react";
import { useDevice } from "@/components/device-provider";
import { getSupabase } from "@/lib/supabase";
import { db, type PendingTransfer } from "@/lib/db";
import { getOutgoingQueue } from "@/lib/queue";
import { getPairingContacts, isTrustedLocally } from "@/lib/pairing";
import { shouldActivateTransfer } from "@/lib/presence.mjs";
import { SupabaseRtcPeer } from "@/lib/transfer/rtc";
import { CHUNK_BYTES, TransferSender, parseControl, sendControl, type TransferControl } from "@/lib/transfer/stream";

/** PWA foreground coordinator. It NEVER uploads bytes or persists source files remotely. */
export function PendingEngine() {
  const {device}=useDevice();
  const working=useRef(false);
  const current=useRef<{close:()=>void}|null>(null);
  const [message,setMessage]=useState("");
  const [active,setActive]=useState("");
  const cancel=useCallback(()=>{current.current?.close();current.current=null;},[]);

  const run=useCallback(async (entry:PendingTransfer, senderId:string, receiverId:string, fileType:string) => {
    const client=getSupabase(); if(!client || !entry.source) return;
    const res=await client.rpc("activate_pending_transfer",{p_sender_device_id:senderId,p_transfer_id:entry.transferId});
    if(res.error) throw res.error;
    if(!res.data || typeof res.data.room_id !== "string") return;
    const source=entry.source;
    const file=new File([source],entry.fileName,{type:fileType || "application/octet-stream"});
    let finished=false;
    let started=false;
    let settled=false;
    let timer:ReturnType<typeof setTimeout> | undefined;
    const controller=new AbortController();
    let peer:SupabaseRtcPeer | null=null;
    let sender:TransferSender | null=null;
    let lastSaved=0;
    setActive(entry.fileName);
    await new Promise<void>(resolve=>{
      const done=async (success:boolean,message?:string)=>{
        if(settled) return;
        settled=true;
        if(timer) clearTimeout(timer);
        controller.abort();
        peer?.close();
        current.current=null;
        if(success){
          await db.pending.delete(entry.transferId);
          await db.offsets.delete(entry.transferId);
          setMessage(`Sent ${entry.fileName} successfully.`);
        }else{
          // If the sender closes, the original Blob remains queued locally.
          await client.rpc("park_pending_transfer",{p_sender_device_id:senderId,p_transfer_id:entry.transferId});
          await db.pending.update(entry.transferId,{status:"pending",updatedAt:Date.now()});
          if(message) setMessage(message);
        }
        setActive("");
        window.dispatchEvent(new Event("pend:queue-changed"));
        resolve();
      };
      const resetWatchdog=()=>{
        if(timer)clearTimeout(timer);
        timer=setTimeout(()=>void done(false,"Transfer stalled. File remains Pending."),90_000);
      };
      resetWatchdog();
      try {
        peer=new SupabaseRtcPeer({client,roomId:res.data.room_id,deviceId:senderId,role:"sender",
          onState:state=>{if(state==="disconnected"&&!finished)void done(false,"Connection interrupted. Will retry while both apps are open.");},
          onChannel:dc=>{
            dc.onopen=()=>{
              const header:TransferControl={type:"header",protocol:2,transfer_id:entry.transferId,
                file_name:entry.fileName,file_size:file.size,file_type:fileType || "application/octet-stream",
                total_chunks:Math.ceil(file.size/CHUNK_BYTES),chunk_size:65536};
              sendControl(dc,header);
            };
            dc.onmessage=(event:MessageEvent)=>{
              if(typeof event.data!=="string"||settled)return;
              try {
                const msg=parseControl(event.data);
                if(msg.type==="ready"&&!started){
                  if(!Number.isSafeInteger(msg.resume_from_byte)||msg.resume_from_byte<0||msg.resume_from_byte>file.size||
                      (msg.resume_from_byte!==file.size && msg.resume_from_byte%CHUNK_BYTES!==0)){
                    throw new Error("Invalid receiver resume offset");
                  }
                  started=true;
                  resetWatchdog();
                  sender=new TransferSender(dc,file,controller.signal,bytes=>{
                    if(bytes-lastSaved>=1024*1024||bytes===file.size){
                      lastSaved=bytes;
                      void db.offsets.put({transferId:entry.transferId,bytesTransferred:bytes,updatedAt:Date.now()});
                    }
                  },()=>undefined);
                  void sender.start(msg.resume_from_byte).catch(err=>{
                    if(!settled)void done(false,err instanceof Error?err.message:"Transfer interrupted");
                  });
                }else if(msg.type==="ack"&&sender){sender.acknowledge(msg.received_bytes);resetWatchdog();}
                else if(msg.type==="pause"){sender?.remotePause(true);}
                else if(msg.type==="resume"){sender?.remotePause(false);}
                else if(msg.type==="finished"){
                  if(!sender||sender.confirmedBytes!==file.size)throw new Error("Receipt not confirmed");
                  finished=true;void done(true);
                }else if(msg.type==="cancel"||msg.type==="error"){
                  void done(false,"Receiver declined or cancelled the transfer.");
                }
              }catch(err){void done(false,err instanceof Error?err.message:"Invalid transfer response");}
            };
            dc.onclose=()=>{if(!finished&&!settled)void done(false,"Connection closed; will retry when available.");};
          },
        });
        current.current={close:()=>{void done(false);}};
        void peer.start().catch(err=>void done(false,err instanceof Error?err.message:"Could not open peer connection"));
      }catch(err){void done(false,err instanceof Error?err.message:"Unable to prepare pending transfer");}
    });
  },[]);

  const check=useCallback(async()=>{
    if(!device || !navigator.onLine || working.current || device.availability_mode!=="available" )return;
    const client=getSupabase();if(!client)return;
    working.current=true;
    try{
      const local=await db.pending.orderBy("updatedAt").toArray();
      if(!local.length)return;
      const [rows,contacts]=await Promise.all([getOutgoingQueue(client,device.id),getPairingContacts(client,device.id)]);
      for(const item of local){
        const row=rows.find(r=>r.id===item.transferId);
        if(!row || ["completed","cancelled","expired"].includes(row.status)){
          await db.pending.delete(item.transferId);continue;
        }
        if(row.status!=="pending"){
          // On return after a killed tab, a stale WebRTC room may have no sender.
          await client.rpc("recover_abandoned_transfer",{
            p_sender_device_id:device.id,p_transfer_id:item.transferId,
          });
          continue;
        }
        if(!item.source)continue;
        const c=contacts.find(v=>v.peer.id===item.receiverId&&v.pairing.status==="paired");
        if(!c||!await isTrustedLocally(c.peer)||!shouldActivateTransfer(c.peer))continue;
        await run(item,device.id,item.receiverId,row.file_type);
        break; // one transfer at once in this browser, ≤2 system-wide in SQL
      }
    }catch(err){setMessage(err instanceof Error?err.message:"Queue check failed");}
    finally{working.current=false;}
  },[device,run]);

  useEffect(()=>{
    void check();
    const interval=window.setInterval(()=>void check(),5000);
    const trigger=()=>void check();
    window.addEventListener("pend:queue-changed",trigger);
    window.addEventListener("online",trigger);
    return()=>{window.clearInterval(interval);window.removeEventListener("pend:queue-changed",trigger);
      window.removeEventListener("online",trigger);cancel();};
  },[check,cancel]);

  if(!active && !message)return null;
  return <div className="fixed bottom-23 left-4 z-40 max-w-xs rounded-xl border border-cyan-400/20 bg-[#142033] p-3 text-xs text-white/80 shadow-xl md:bottom-4 md:left-68">
    <div className="flex items-center gap-2"><CloudOff size={17} className="shrink-0 text-cyan-300"/>
      <p className="flex-1 break-words">{active?`P2P transfer: ${active}`:message}</p>
      {!active&&<button aria-label="Dismiss queue notice" onClick={()=>setMessage("")}><X size={15}/></button>}
    </div>
    {active&&<p className="mt-1 text-white/50">Keep both PEND tabs open. <Link href="/" className="underline">View queue</Link></p>}
  </div>;
}
