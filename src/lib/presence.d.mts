export type PresenceInfo = {state: "offline" | "busy" | "waiting-wifi" | "available";label:string};
export declare const HEARTBEAT_INTERVAL_MS: number;
export declare const PRESENCE_TTL_MS: number;
export declare function derivePresence(device: {
  last_seen: string | null;
  is_online: boolean;
  is_available: boolean;
  availability_mode?: string;
  wifi_only?: boolean;
  network_type?: string;
  download_on_data?: boolean;
}, now?: number): PresenceInfo;
export declare function detectableNetwork(connection?: {type?: string} | null): "wifi" | "ethernet" | "cellular" | "unknown";
export declare function shouldActivateTransfer(device: Parameters<typeof derivePresence>[0],now?: number): boolean;
