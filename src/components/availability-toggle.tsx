"use client";
import { useState } from "react";
import { useDevice } from "@/components/device-provider";
import { Button } from "@/components/ui/button";
export function AvailabilityToggle() {
  const { device, updatePreferences } = useDevice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!device) return null;
  async function toggle() {
    setBusy(true); setError("");
    try { await updatePreferences({ is_available: !device!.is_available, availability_mode: device!.is_available ? "busy" : "available" }); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update status"); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-2"><Button variant="secondary" size="sm" disabled={busy} onClick={toggle}><span className={`size-2 rounded-full ${device.is_available ? "bg-emerald-400" : "bg-amber-400"}`}/>{device.is_available ? "Available" : "Busy"}</Button>{error && <span role="alert" className="text-xs text-rose-300">{error}</span>}</div>;
}
