export const CLIPBOARD_LIMIT_BYTES: number;
export interface ClipboardEnvelope {
  v: 1; id: string; sender: string; receiver: string; createdAt: number; iv: string; body: string;
}
export function clipboardTopic(a: string, b: string): string;
export function encryptClipboard(privateKey: CryptoKey, peerPublicJwk: string, text: string,
  senderId: string, receiverId: string): Promise<ClipboardEnvelope>;
export function decryptClipboard(privateKey: CryptoKey, peerPublicJwk: string,
  envelope: ClipboardEnvelope, senderId: string, receiverId: string, now?: number): Promise<string>;
