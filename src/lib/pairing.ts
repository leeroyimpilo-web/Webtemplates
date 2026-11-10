import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { hashTransferCode, randomTransferCode } from "@/lib/transfer/rooms";
import { getOrCreateIdentity } from "@/lib/identity";
import type { DeviceRecord } from "@/lib/types";

export type PairingStatus = "pending" | "paired" | "revoked";
export interface PairingRecord {
  id: string;
  device_a_id: string;
  device_b_id: string;
  a_confirmed: boolean;
  b_confirmed: boolean;
  status: PairingStatus;
  code_expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}
export interface PairingContact {
  pairing: PairingRecord;
  peer: DeviceRecord;
  localConfirmed: boolean;
  remoteConfirmed: boolean;
}

export async function fingerprintMatches(publicKey: string, expected: string): Promise<boolean> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(publicKey));
  const actual = Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, "0")).join("");
  return actual === expected;
}

export async function createPairingCode(client: SupabaseClient, deviceId: string) {
  const code = randomTransferCode();
  const { data, error } = await client.rpc("create_pairing_code", {
    p_requester_device_id: deviceId, p_code_hash: await hashTransferCode(code),
  });
  if (error) throw error;
  if (data !== true) throw new Error("Too many active pairing codes or a code conflict. Try again later.");
  return { code, expiresAt: Date.now() + 10 * 60_000 };
}

export async function joinPairingCode(client: SupabaseClient, deviceId: string, code: string): Promise<string> {
  const { data, error } = await client.rpc("join_pairing_code", {
    p_joiner_device_id: deviceId, p_code_hash: await hashTransferCode(code),
  });
  if (error) throw error;
  if (typeof data !== "string") throw new Error("Code invalid, used, expired, or pairing attempts exceeded. Please request a fresh code.");
  return data;
}

export async function getPairingContacts(client: SupabaseClient, deviceId: string): Promise<PairingContact[]> {
  const { data: pairs, error } = await client.from("pairings").select("id,device_a_id,device_b_id,a_confirmed,b_confirmed,status,code_expires_at,created_at,revoked_at")
    .or(`device_a_id.eq.${deviceId},device_b_id.eq.${deviceId}`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const filtered = (pairs ?? []) as PairingRecord[];
  const ids = filtered.filter(p => p.status !== "revoked").map(p => p.device_a_id === deviceId ? p.device_b_id : p.device_a_id);
  if (!ids.length) return [];
  const { data: others, error: peerError } = await client.from("devices").select("*").in("id", ids);
  if (peerError) throw peerError;
  const byId = new Map((others ?? []).map(row => [row.id as string, row as DeviceRecord]));
  const contacts: PairingContact[] = [];
  const localIdentity = await db.identity.get("current");
  const { data: ownRow } = await client.from("devices").select("device_fingerprint").eq("id", deviceId).maybeSingle();
  const canRestoreTrust = !!localIdentity && ownRow?.device_fingerprint === localIdentity.fingerprint;
  for (const pairing of filtered) {
    if (pairing.status === "revoked") {
      await db.trustedDevices.delete(pairing.device_a_id === deviceId ? pairing.device_b_id : pairing.device_a_id);
      continue;
    }
    const isA = pairing.device_a_id === deviceId;
    const peer = byId.get(isA ? pairing.device_b_id : pairing.device_a_id);
    if (!peer) continue;
    if (!await fingerprintMatches(peer.public_key, peer.device_fingerprint)) {
      // Never present a key whose fingerprint disagrees with the device row.
      continue;
    }
    if (pairing.status === "paired") {
      const pinned = await db.trustedDevices.get(peer.id);
      if (pinned && pinned.publicKey !== peer.public_key) {
        // A changed remote key must not inherit an existing trust decision.
        await db.trustedDevices.delete(peer.id);
      } else if (!pinned && pairing.a_confirmed && pairing.b_confirmed && canRestoreTrust) {
        // The other user may have been the final confirmer. Server-side mutual
        // confirmation plus the ORIGINAL local private key allow safe recovery.
        await db.trustedDevices.put({deviceId: peer.id, publicKey: peer.public_key, pairedAt: Date.now()});
      }
    }
    contacts.push({ pairing, peer, localConfirmed: isA ? pairing.a_confirmed : pairing.b_confirmed,
      remoteConfirmed: isA ? pairing.b_confirmed : pairing.a_confirmed });
  }
  return contacts;
}

export async function confirmPairing(client: SupabaseClient, contact: PairingContact, deviceId: string, accept: boolean) {
  const identity = await getOrCreateIdentity();
  if (!identity || !await fingerprintMatches(contact.peer.public_key, contact.peer.device_fingerprint)) {
    throw new Error("Peer public key verification failed. Do not confirm pairing.");
  }
  const { data, error } = await client.rpc("confirm_pairing", {
    p_pairing_id: contact.pairing.id, p_my_device_id: deviceId, p_accept: accept,
  });
  if (error) throw error;
  if (data === "paired") {
    await db.trustedDevices.put({ deviceId: contact.peer.id, publicKey: contact.peer.public_key, pairedAt: Date.now() });
  } else if (!accept || data === "revoked") await db.trustedDevices.delete(contact.peer.id);
  return data as PairingStatus;
}

export async function revokePairing(client: SupabaseClient, contact: PairingContact, deviceId: string) {
  const { error } = await client.rpc("revoke_pairing", {
    p_pairing_id: contact.pairing.id, p_my_device_id: deviceId,
  });
  if (error) throw error;
  await db.trustedDevices.delete(contact.peer.id);
}

export async function isTrustedLocally(peer: DeviceRecord): Promise<boolean> {
  const pinned = await db.trustedDevices.get(peer.id);
  return !!pinned && pinned.publicKey === peer.public_key &&
    await fingerprintMatches(peer.public_key, peer.device_fingerprint);
}
