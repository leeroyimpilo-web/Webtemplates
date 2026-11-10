import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import type { PendingTransfer } from "@/lib/db";

export interface QueueRow {
  id:string; sender_device_id:string; receiver_device_id:string; file_name:string;
  file_size:number; file_type:string; status:string; bytes_transferred:number;
  expires_at:string; created_at:string;
}

export async function queueTrustedFile(client:SupabaseClient,sender:string,receiver:string,file:File,note="") {
  // Browser storage is not a guarantee for arbitrarily large Blobs. Refuse a
  // transfer whose original source cannot be retained for retry.
  const estimate = await navigator.storage?.estimate?.();
  if (estimate?.quota && estimate.usage != null && file.size > estimate.quota - estimate.usage) {
    throw new Error("Not enough browser storage to keep this file pending. Choose a smaller file or free space.");
  }
  const {data,error}=await client.rpc("queue_trusted_transfer",{
    p_sender_device_id:sender,p_receiver_device_id:receiver,p_file_name:file.name,
    p_file_size:file.size,p_file_type:file.type || "application/octet-stream",p_note:note || null,
  });
  if(error) throw error;
  if(typeof data !== "string") throw new Error("Could not create pending transfer.");
  const item:PendingTransfer={transferId:data,receiverId:receiver,fileName:file.name,fileSize:file.size,
    source:file,status:"pending",updatedAt:Date.now()};
  try {await db.pending.put(item);}
  catch (cause) {
    // Do not leave a metadata-only promise to send bytes we no longer have.
    await client.rpc("cancel_queued_transfer",{p_my_device_id:sender,p_transfer_id:data});
    throw cause;
  }
  try {await navigator.storage?.persist?.();} catch { /* Browser may decline */ }
  window.dispatchEvent(new Event("pend:queue-changed"));
  return data as string;
}

export async function cancelPending(client:SupabaseClient,deviceId:string,transferId:string) {
  const {error}=await client.rpc("cancel_queued_transfer",{p_my_device_id:deviceId,p_transfer_id:transferId});
  if(error) throw error;
  await db.pending.delete(transferId);
  await db.offsets.delete(transferId);
  window.dispatchEvent(new Event("pend:queue-changed"));
}

export async function getOutgoingQueue(client:SupabaseClient,senderId:string):Promise<QueueRow[]> {
  const {data,error}=await client.from("transfers").select("id,sender_device_id,receiver_device_id,file_name,file_size,file_type,status,bytes_transferred,expires_at,created_at")
    .eq("sender_device_id",senderId).in("status",["pending","connecting","transferring","paused","completed","cancelled","expired"])
    .order("created_at",{ascending:false}).limit(100);
  if(error) throw error;
  return (data ?? []) as QueueRow[];
}
