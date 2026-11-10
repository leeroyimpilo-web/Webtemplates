import { db, type LocalIdentity } from "@/lib/db";

const DEVICE_ID_KEY = "pend:device-id:v1";

export function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export function inferPlatform(): string {
  const agent = navigator.userAgent;
  if (/Android/i.test(agent)) return "Android";
  if (/iPad|iPhone|iPod/i.test(agent)) return "iOS";
  if (/Windows/i.test(agent)) return "Windows";
  if (/Macintosh|Mac OS/i.test(agent)) return "macOS";
  if (/Linux/i.test(agent)) return "Linux";
  return "Web";
}

export async function getOrCreateIdentity(): Promise<LocalIdentity> {
  const existing = await db.identity.get("current");
  if (existing) return existing;

  // ECDH P-256 is supported by Web Crypto; the private key is non-exportable.
  // Phase 2 will add authenticated pairing and pinned peer public keys.
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey", "deriveBits"]
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicKey = JSON.stringify(publicJwk);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(publicKey));
  const fingerprint = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const record: LocalIdentity = { key: "current", publicKey, privateKey: pair.privateKey, fingerprint };
  await db.identity.put(record);
  return record;
}

export function formatFingerprint(fingerprint: string) {
  return (fingerprint.match(/.{1,4}/g) ?? []).join(":").toUpperCase();
}
