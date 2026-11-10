import Dexie, { type Table } from "dexie";

export interface LocalIdentity {
  key: "current";
  publicKey: string;            // JSON-encoded public JWK
  privateKey: CryptoKey;        // non-extractable; structured-cloned into IndexedDB
  fingerprint: string;          // SHA-256 of public JWK, hex
}
export interface PendingTransfer {
  transferId: string;
  receiverId: string;
  fileName: string;
  fileSize: number;
  status: "pending" | "paused";
  source?: Blob;                // local-only; no Supabase Storage upload
  updatedAt: number;
}
export interface InboxItem {
  transferId: string;
  fileName: string;
  fileSize: number;
  senderId: string;
  receivedAt: number;
  localBlob?: Blob;
  opfsName?: string;    // Origin Private File System entry (never uploaded)
}
export interface ResumeOffset { transferId: string; bytesTransferred: number; updatedAt: number }
export interface TrustedDevice { deviceId: string; publicKey: string; pairedAt: number }

class PendDatabase extends Dexie {
  identity!: Table<LocalIdentity, string>;
  pending!: Table<PendingTransfer, string>;
  inbox!: Table<InboxItem, string>;
  offsets!: Table<ResumeOffset, string>;
  trustedDevices!: Table<TrustedDevice, string>;

  constructor() {
    super("pend-local-v1");
    this.version(1).stores({
      identity: "key",
      pending: "transferId,receiverId,status,updatedAt",
      inbox: "transferId,senderId,receivedAt",
      offsets: "transferId,updatedAt",
      trustedDevices: "deviceId,pairedAt",
    });
  }
}
export const db = new PendDatabase();
