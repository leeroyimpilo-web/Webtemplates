"use client";
import { useEffect } from "react";
import { useDevice } from "@/components/device-provider";
import { getSupabase } from "@/lib/supabase";
import { detectableNetwork, HEARTBEAT_INTERVAL_MS } from "@/lib/presence.mjs";

type NetworkNavigator = Navigator & {connection?: {type?: string}};

/** Browser-only heartbeat. Hidden tabs and closed PWAs cannot guarantee 20s ticks. */
export function PresenceHeartbeat() {
  const { device } = useDevice();
  useEffect(() => {
    if (!device) return;
    let running = false;
    let disposed = false;
    async function beat() {
      if (disposed || !navigator.onLine || running) return;
      running = true;
      try {
        const client = getSupabase();
        if (!client) return;
        await client.rpc("heartbeat_device", {
          p_device_id: device!.id,
          p_network_type: detectableNetwork((navigator as NetworkNavigator).connection),
        });
      } catch { /* Last-seen expires naturally after two missed heartbeats. */ }
      finally { running = false; }
    }
    void beat();
    const tick = window.setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
    window.addEventListener("online", beat);
    return () => {disposed = true;window.clearInterval(tick);window.removeEventListener("online",beat);};
  }, [device?.id]);
  return null;
}
