import type { SupabaseClient } from "@supabase/supabase-js";

export function randomTransferCode(): string {
  // crypto.randomInt is not available in browsers; rejection sampling avoids modulo bias.
  const buffer = new Uint32Array(1);
  const max = Math.floor(4294967296 / 1000000) * 1000000;
  let value: number;
  do { crypto.getRandomValues(buffer); value = buffer[0]; } while (value >= max);
  return String(value % 1000000).padStart(6, "0");
}
export async function hashTransferCode(code: string): Promise<string> {
  if (!/^\d{6}$/.test(code)) throw new Error("Enter exactly six digits.");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(raw), v => v.toString(16).padStart(2, "0")).join("");
}
export async function createTransferRoom(client: SupabaseClient, deviceId: string, code: string): Promise<string> {
  const { data, error } = await client.rpc("create_transfer_room", {
    p_sender_device_id: deviceId, p_code_hash: await hashTransferCode(code),
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Server did not create a room.");
  return data;
}
export async function joinTransferRoom(client: SupabaseClient, deviceId: string, code: string): Promise<string> {
  const { data, error } = await client.rpc("join_transfer_room", {
    p_receiver_device_id: deviceId, p_code_hash: await hashTransferCode(code),
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Room could not be joined.");
  return data;
}
