/** Conservative, testable auto-receive rules. Never auto-open received files. */
export const AUTO_ACCEPT_LIMIT_BYTES = 5 * 1024 ** 3;
export const BLOCKED_EXTENSIONS = Object.freeze(["exe", "apk", "bat", "msi", "sh", "scr", "pendpack"]);

export function assessAutoReceive({
  paired, revoked = false, pinned = false, available = true,
  fileName, fileSize, wifiOnly = true, networkType = "unknown", online = true,
  hasPrivateInbox = true,
}) {
  if (!paired || revoked || !pinned) return { auto: false, reason: "Sender is not verified as trusted." };
  if (!online || !available) return { auto: false, reason: "Device is unavailable." };
  if (!Number.isSafeInteger(fileSize) || fileSize < 0 || !fileName || typeof fileName !== "string")
    return { auto: false, reason: "Invalid file metadata." };
  if (fileSize > AUTO_ACCEPT_LIMIT_BYTES)
    return { auto: false, reason: "File exceeds the 5 GB auto-accept limit." };
  const ext = fileName.split(".").at(-1)?.toLowerCase() ?? "";
  if (BLOCKED_EXTENSIONS.includes(ext)) return { auto: false, reason: "Potentially unsafe file type needs manual approval." };
  if (wifiOnly && !["wifi", "ethernet"].includes(networkType)) {
    return { auto: false, reason: networkType === "cellular" ? "Waiting for Wi-Fi; mobile data blocked." : "Wi-Fi cannot be verified; approve manually." };
  }
  if (!hasPrivateInbox) return { auto: false, reason: "Browser private Inbox storage is unavailable." };
  return { auto: true, reason: "Trusted sender and safe file: save privately without opening." };
}
