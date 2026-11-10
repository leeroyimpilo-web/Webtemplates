export const AUTO_ACCEPT_LIMIT_BYTES: number;
export const BLOCKED_EXTENSIONS: readonly string[];
export function assessAutoReceive(input: {
  paired: boolean; revoked?: boolean; pinned?: boolean; available?: boolean;
  fileName: string; fileSize: number; wifiOnly?: boolean; networkType?: string;
  online?: boolean; hasPrivateInbox?: boolean;
}): { auto: boolean; reason: string };
