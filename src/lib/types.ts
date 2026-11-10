export interface DeviceRecord {
  id: string;
  user_id: string;
  device_name: string;
  device_fingerprint: string;
  public_key: string;
  platform: string;
  last_seen: string | null;
  is_online: boolean;
  is_available: boolean;
  wifi_only: boolean;
  created_at: string;
}

export type TransferStatus =
  | "pending" | "connecting" | "transferring" | "paused"
  | "completed" | "failed" | "expired" | "cancelled";
