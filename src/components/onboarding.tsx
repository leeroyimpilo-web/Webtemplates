"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, Fingerprint, HardDrive, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useDevice } from "@/components/device-provider";

export function Onboarding() {
  const { registerDevice, error } = useDevice();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setLocalError("");
    try { await registerDevice(name); }
    catch (e) { setLocalError(e instanceof Error ? e.message : "Registration failed"); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto flex min-h-svh max-w-xl items-center px-5 py-12">
    <Card className="w-full overflow-hidden">
      <div className="border-b border-white/10 bg-gradient-to-br from-violet-500/20 to-cyan-400/10 p-8">
        <div className="mb-7 flex size-14 items-center justify-center rounded-2xl bg-violet-500 text-2xl font-black text-white">P.</div>
        <div className="mb-2 text-xs font-bold uppercase tracking-[0.23em] text-violet-300">Welcome to PEND</div>
        <h1 className="text-3xl font-bold tracking-tight">Your files. Your devices. Your control.</h1>
        <p className="mt-3 text-sm leading-6 text-white/60">Set up this device. No email or password required.</p>
      </div>
      <form className="space-y-5 p-7" onSubmit={submit}>
        <label className="block text-sm font-medium" htmlFor="device-name">Name this device</label>
        <input id="device-name" required minLength={2} maxLength={48} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. My Samsung A34" autoComplete="off"
          className="h-12 w-full rounded-xl border border-white/15 bg-[#0e1220] px-4 text-white outline-none placeholder:text-white/30 focus:border-violet-400" />
        <p className="text-xs text-white/45">Your display name will only be shown to devices you choose to pair with.</p>
        <div className="grid gap-3 text-sm text-white/65 sm:grid-cols-3">
          <div className="flex items-center gap-2"><Fingerprint size={18} className="text-violet-300" />Unique identity</div>
          <div className="flex items-center gap-2"><LockKeyhole size={18} className="text-violet-300" />Local private key</div>
          <div className="flex items-center gap-2"><HardDrive size={18} className="text-violet-300" />No cloud files</div>
        </div>
        {(localError || error) && <p role="alert" className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{localError || error}</p>}
        <Button className="w-full" size="lg" disabled={busy || name.trim().length < 2}>
          {busy ? "Registering this device…" : "Set up device"} <ArrowRight size={18} />
        </Button>
      </form>
    </Card>
  </div>;
}
