import type { SupabaseClient } from "@supabase/supabase-js";

export interface TrustedTransferRoom {
  room_id: string;
  transfer_id: string;
  sender_device_id: string;
  file_name: string;
  file_size: number;
  file_type: string;
}

export async function createTrustedTransfer(client: SupabaseClient,
  senderDeviceId: string, receiverDeviceId: string, file: File, note = "") {
  const { data, error } = await client.rpc("create_trusted_transfer", {
    p_sender_device_id: senderDeviceId,
    p_receiver_device_id: receiverDeviceId,
    p_file_name: file.name,
    p_file_size: file.size,
    p_file_type: file.type || "application/octet-stream",
    p_note: note || null,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || typeof data.room_id !== "string" || typeof data.transfer_id !== "string") {
    throw new Error("Trusted transfer invitation failed.");
  }
  return { roomId: data.room_id as string, transferId: data.transfer_id as string };
}

export async function getTrustedRoom(client: SupabaseClient, deviceId: string, transferId: string): Promise<TrustedTransferRoom | null> {
  const { data, error } = await client.rpc("get_trusted_transfer_room", {
    p_transfer_id: transferId, p_my_device_id: deviceId,
  });
  if (error) throw error;
  return data as TrustedTransferRoom | null;
}
