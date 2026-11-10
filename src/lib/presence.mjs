export const HEARTBEAT_INTERVAL_MS = 20_000;
export const PRESENCE_TTL_MS = 40_000;

export function derivePresence(device, now = Date.now()) {
  const fresh = Number.isFinite(Date.parse(device.last_seen ?? "")) &&
    now - Date.parse(device.last_seen) < PRESENCE_TTL_MS &&
    now >= Date.parse(device.last_seen) - 5_000;
  if (!fresh || !device.is_online || device.availability_mode === "invisible") {
    return { state: "offline", label: "Offline" };
  }
  if (device.availability_mode === "busy" || !device.is_available) {
    return { state: "busy", label: "Busy" };
  }
  if (device.wifi_only && !device.download_on_data &&
    !["wifi", "ethernet"].includes(device.network_type ?? "unknown")) {
    return { state: "waiting-wifi", label: "Waiting for Wi-Fi" };
  }
  return { state: "available", label: "Online · Available" };
}

export function detectableNetwork(connection) {
  const type = connection?.type;
  return type === "wifi" || type === "ethernet" || type === "cellular" ? type : "unknown";
}

export function shouldActivateTransfer(device, now = Date.now()) {
  return derivePresence(device, now).state === "available";
}
