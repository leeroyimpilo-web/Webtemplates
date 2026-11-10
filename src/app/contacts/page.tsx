"use client";
import { derivePresence } from "@/lib/presence.mjs";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { CheckCircle2, Clock3, Copy, LockKeyhole, QrCode, ShieldAlert, ShieldCheck, Smartphone, UserRoundPlus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useDevice } from "@/components/device-provider";
import { getSupabase } from "@/lib/supabase";
import { formatFingerprint } from "@/lib/identity";
import { confirmPairing, createPairingCode, getPairingContacts, joinPairingCode, revokePairing, type PairingContact } from "@/lib/pairing";

const niceTime = (timestamp: string | null) => timestamp ? new Date(timestamp).toLocaleString() : "Never";

export default function ContactsPage() {
  const { device } = useDevice();
  const [contacts, setContacts] = useState<PairingContact[]>([]);
  const [code, setCode] = useState("");
  const [codeExpires, setCodeExpires] = useState(0);
  const [qr, setQr] = useState("");
  const [entered, setEntered] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [seconds, setSeconds] = useState(0);

  const refresh = useCallback(async () => {
    if (!device) return;
    const client = getSupabase();
    if (!client) return;
    try { setContacts(await getPairingContacts(client, device.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load paired devices."); }
  }, [device]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(Math.max(0, Math.ceil((codeExpires - Date.now()) / 1000))), 1000);
    setSeconds(Math.max(0, Math.ceil((codeExpires - Date.now()) / 1000)));
    return () => clearInterval(timer);
  }, [codeExpires]);

  useEffect(() => {
    let active = true;
    if (!code) { setQr(""); return; }
    void QRCode.toDataURL(`PEND:PAIR:${code}`, { width: 240, margin: 2, errorCorrectionLevel: "M" })
      .then(data => { if (active) setQr(data); })
      .catch(() => { if (active) setQr(""); });
    return () => { active = false; };
  }, [code]);

  const paired = useMemo(() => contacts.filter(c => c.pairing.status === "paired"), [contacts]);
  const pending = useMemo(() => contacts.filter(c => c.pairing.status === "pending"), [contacts]);

  const create = async () => {
    const client = getSupabase(); if (!client || !device || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const item = await createPairingCode(client, device.id);
      setCode(item.code); setCodeExpires(item.expiresAt);
      setMessage("Share this code privately. Both devices must confirm before they are trusted.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create code."); }
    finally { setBusy(false); }
  };

  const join = async () => {
    const client = getSupabase(); if (!client || !device || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await joinPairingCode(client, device.id, entered);
      setEntered(""); await refresh();
      setMessage("Code accepted. Review the device and confirm on this device; the other device must confirm separately.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Pairing failed."); }
    finally { setBusy(false); }
  };

  const act = async (c: PairingContact, operation: "confirm" | "decline" | "revoke") => {
    const client = getSupabase(); if (!client || !device || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (operation === "revoke") {
        await revokePairing(client, c, device.id);
        setMessage(`${c.peer.device_name} is no longer trusted. Future files need manual acceptance.`);
      } else {
        const status = await confirmPairing(client, c, device.id, operation === "confirm");
        setMessage(status === "paired" ? "Both devices confirmed. Pairing is trusted." :
          status === "pending" ? "You confirmed. Waiting for the other device." : "Pairing declined or expired.");
      }
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Pairing action failed."); }
    finally { setBusy(false); }
  };

  return <div className="space-y-7">
    <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-violet-300">PHASE 3 · TRUSTED CONTACTS</p>
      <h1 className="mt-2 text-3xl font-bold">Contacts</h1>
      <p className="mt-2 max-w-2xl text-sm text-white/60">Pair anywhere with a six-digit code. Both devices review fingerprints and approve. A code expires after ten minutes and can be used once.</p>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-5 p-6">
        <div className="flex items-center gap-3"><QrCode className="text-violet-300"/><h2 className="font-bold">Pair a new device</h2></div>
        <Button disabled={busy} onClick={() => void create()}><UserRoundPlus size={17}/> Generate 6-digit code</Button>
        {!!code && seconds > 0 && <div className="space-y-3 rounded-2xl border border-violet-400/20 bg-violet-400/5 p-4 text-center">
          <p className="text-xs uppercase tracking-wider text-violet-300">One-time pairing code</p>
          <p aria-label={`Pairing code ${code.split("").join(" ")}`} className="font-mono text-4xl font-black tracking-[0.12em] sm:text-5xl">{code}</p>
          <p className="flex items-center justify-center gap-2 text-xs text-amber-300"><Clock3 size={14}/> Expires in {String(Math.floor(seconds / 60)).padStart(2,"0")}:{String(seconds % 60).padStart(2,"0")}</p>
          {qr && <div className="mx-auto w-fit rounded-xl bg-white p-2"><img src={qr} width={224} height={224} alt="QR pairing code"/></div>}
          <div className="flex flex-wrap justify-center gap-2"><Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(code)}><Copy size={15}/> Copy</Button>
            <a className="inline-flex items-center rounded-xl border border-white/20 px-3 text-xs font-semibold" href={`https://wa.me/?text=${encodeURIComponent(`Pair with my PEND device using this 10-minute code: ${code}. Both devices must approve.`)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a></div>
        </div>}
        {!!code && seconds === 0 && <p className="text-sm text-amber-300">Code expired. Generate a new one.</p>}
      </Card>
      <Card className="space-y-5 p-6">
        <div className="flex items-center gap-3"><LockKeyhole className="text-cyan-300"/><h2 className="font-bold">Enter a pairing code</h2></div>
        <label className="block text-xs text-white/55" htmlFor="pair-code">Code received from the other device</label>
        <input id="pair-code" type="text" inputMode="numeric" autoComplete="off" maxLength={6} value={entered}
          onChange={e=>setEntered(e.target.value.replace(/\D/g,"").slice(0,6))}
          className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-center font-mono text-3xl tracking-[0.2em] outline-none focus:border-violet-300" placeholder="000000"/>
        <Button disabled={busy || entered.length !== 6} onClick={() => void join()} className="w-full">Find pairing request</Button>
        <p className="text-xs text-white/50">No scanning, location access or shared Wi-Fi needed. Codes cannot be reused.</p>
      </Card>
    </div>

    {error && <div role="alert" className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
    {message && <div role="status" className="rounded-xl bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200">{message}</div>}

    <section className="space-y-4"><h2 className="flex items-center gap-2 text-xl font-bold"><ShieldAlert className="text-amber-300"/> Awaiting confirmation <span className="text-sm font-normal text-white/50">({pending.length})</span></h2>
      {!pending.length && <Card className="p-6 text-sm text-white/50">No pairing requests pending. On the other device, enter your code to start.</Card>}
      {pending.map(c => <Card key={c.pairing.id} className="space-y-4 p-5">
        <div className="flex items-center gap-3"><Smartphone className="text-violet-300"/><div><h3 className="font-semibold">{c.peer.device_name}</h3><p className="text-xs text-white/45">{c.peer.platform} · City: unavailable · Last paired: Never</p></div></div>
        <p className="break-all rounded-xl bg-black/20 p-3 text-xs text-white/70">Fingerprint: {formatFingerprint(c.peer.device_fingerprint)}</p>
        <p className="text-xs text-amber-200">{c.localConfirmed ? "You confirmed. Waiting for the other device." : "Confirm the device name and fingerprint with the owner before accepting."}</p>
        <div className="flex flex-wrap gap-2">{!c.localConfirmed && <Button disabled={busy} onClick={()=>void act(c,"confirm")}><CheckCircle2 size={16}/> Yes, pair</Button>}
          <Button disabled={busy} variant="outline" onClick={()=>void act(c,"decline")}><XCircle size={16}/> Decline</Button></div>
      </Card>)}
    </section>

    <section className="space-y-4"><h2 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck className="text-emerald-300"/> Paired devices <span className="text-sm font-normal text-white/50">({paired.length})</span></h2>
      {!paired.length && <Card className="p-6 text-sm text-white/50">No trusted devices yet. Complete confirmation on both sides.</Card>}
      {paired.map(c => <Card key={c.pairing.id} className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300"><ShieldCheck size={22}/></span>
          <div><h3 className="font-semibold">{c.peer.device_name}</h3><p className="text-xs text-white/50">{c.peer.platform} · {derivePresence(c.peer).label}</p>
            <p className="mt-1 text-xs text-white/40">Last seen: {niceTime(c.peer.last_seen)} · {c.peer.device_fingerprint.slice(0,16)}…</p></div></div>
        <div className="flex shrink-0 flex-wrap gap-2"><Button size="sm" asChild><Link href={`/send?to=${encodeURIComponent(c.peer.id)}`}>Send file</Link></Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={()=>void act(c,"revoke")}>Revoke</Button></div>
      </Card>)}
    </section>
    <p className="text-xs leading-6 text-white/40">Paired files can auto-save only while PEND is open and this browser allows private storage. Dangerous file types, files over 5 GB, and unknown/mobile network types under Wi-Fi-only always need approval. Pairing keys are pinned locally; revocation disables trusted transfers.</p>
  </div>;
}
