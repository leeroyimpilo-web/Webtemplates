"use client";
import { useState } from "react";
import { Fingerprint, Radio, Shield, Wifi } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDevice } from "@/components/device-provider";
import { formatFingerprint } from "@/lib/identity";
export default function SettingsPage() {
  const { device, updatePreferences } = useDevice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!device) return null;
  async function update(changes: {wifi_only?: boolean;is_available?: boolean;availability_mode?: "available"|"busy"|"invisible";download_on_data?: boolean}) {
    setBusy(true);setError("");
    try { await updatePreferences(changes); }
    catch (e) {setError(e instanceof Error ? e.message : "Save failed");}
    finally {setBusy(false);}
  }
  return <div className="space-y-7"><div><p className="text-xs font-bold uppercase tracking-[0.25em] text-violet-300">PREFERENCES & SECURITY</p><h1 className="mt-2 text-3xl font-bold">Settings</h1><p className="mt-2 text-white/50">This device’s identity and preferences.</p></div>
    <Card className="p-6"><h2 className="mb-5 flex items-center gap-2 text-lg font-bold"><Fingerprint size={20} className="text-violet-300"/> Device identity</h2><dl className="space-y-4 text-sm"><div><dt className="text-xs text-white/40">Device name</dt><dd className="mt-1 font-medium">{device.device_name}</dd></div><div><dt className="text-xs text-white/40">Platform</dt><dd className="mt-1 font-medium">{device.platform}</dd></div><div><dt className="text-xs text-white/40">Public key fingerprint (SHA-256)</dt><dd className="mt-1 break-all font-mono text-xs leading-6 text-white/70">{formatFingerprint(device.device_fingerprint)}</dd></div></dl></Card>
    <Card className="space-y-6 p-6"><h2 className="flex items-center gap-2 text-lg font-bold"><Shield size={20} className="text-violet-300"/> Transfer preferences</h2><div className="flex items-center justify-between gap-3"><div><p className="flex items-center gap-2 font-medium"><Wifi size={16}/> Wi-Fi only</p><p className="mt-1 text-xs leading-5 text-white/45">On by default. Automatic trusted receipt requires verified Wi-Fi; unknown networks require manual approval.</p></div><Button variant={device.wifi_only ? "default" : "outline"} size="sm" disabled={busy} onClick={() => void update({wifi_only: !device.wifi_only})} aria-pressed={device.wifi_only}>{device.wifi_only ? "ON" : "OFF"}</Button></div>
      <div className="border-t border-white/10 pt-6"><div className="flex items-center justify-between gap-3"><div><p className="flex items-center gap-2 font-medium"><Radio size={16}/> Available</p><p className="mt-1 text-xs leading-5 text-white/45">Heartbeat runs every 20 seconds while the app stays active. Busy and Invisible stop automatic transfers.</p></div><Button variant={device.is_available ? "default" : "outline"} size="sm" disabled={busy} onClick={() => void update({is_available: !device.is_available})} aria-pressed={device.is_available}>{device.is_available ? "ON" : "OFF"}</Button></div></div>
      <div className="border-t border-white/10 pt-5"><p className="text-sm font-semibold">Availability mode</p><div className="mt-3 flex flex-wrap gap-2">{(["available","busy","invisible"] as const).map(mode=><Button key={mode} size="sm" variant={(device.availability_mode??"available")===mode?"default":"outline"} disabled={busy} onClick={()=>void update({availability_mode:mode,is_available:mode==="available"})}>{mode[0].toUpperCase()+mode.slice(1)}</Button>)}</div><p className="mt-2 text-xs text-white/45">Invisible appears offline to contacts. Busy appears online but blocks automatic starts.</p></div>
      <div className="border-t border-white/10 pt-5"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">Download on Data</p><p className="mt-1 text-xs text-white/45">Explicitly override Wi-Fi-only when your browser cannot verify the network. Mobile data charges may apply.</p></div><Button variant={device.download_on_data?"default":"outline"} size="sm" disabled={busy} onClick={()=>void update({download_on_data:!device.download_on_data})}>{device.download_on_data?"ON":"OFF"}</Button></div></div>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    </Card><p className="text-xs leading-6 text-white/45">Security note: Anonymous Supabase sessions belong to this browser profile. If browser data is erased, the private key and session may be lost. Key backup/account recovery is out of scope for Phase 0.</p></div>;
}
