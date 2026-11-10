"use client";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Clock3, FolderDown, Send, ShieldCheck, Users, Wifi } from "lucide-react";
import { AvailabilityToggle } from "@/components/availability-toggle";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDevice } from "@/components/device-provider";

export default function HomePage() {
  const { device } = useDevice();
  return <div className="space-y-8">
    <section className="relative overflow-hidden rounded-[28px] border border-violet-300/15 bg-[radial-gradient(circle_at_90%_10%,rgba(137,96,255,.30),transparent_45%),linear-gradient(135deg,#242040,#111827)] p-7 sm:p-10">
      <div className="absolute -right-10 -top-14 size-58 rounded-full border border-white/10" aria-hidden="true" />
      <div className="relative z-10"><div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-200/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-violet-200"><ShieldCheck size={14}/> Private by design · Phase 0</div>
        <h1 className="max-w-xl text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">Files don’t need to wait for <span className="text-violet-300">the perfect moment.</span></h1>
        <p className="mt-4 max-w-lg text-sm leading-7 text-white/65 sm:text-base">PEND is being built to queue transfers when people are offline, and deliver to trusted devices automatically when available.</p>
        <div className="mt-7 flex flex-wrap gap-3"><Button asChild><Link href="/send"><Send size={17}/> Explore sending <ArrowRight size={16}/></Link></Button><Button asChild variant="outline"><Link href="/contacts"><Users size={17}/> View contacts</Link></Button></div>
      </div>
    </section>
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-bold">Good to see you, {device?.device_name ?? "there"}.</h2><p className="mt-1 text-sm text-white/45">Your device is registered. Transfers unlock in future phases.</p></div><AvailabilityToggle/></div>
    <section className="grid gap-4 sm:grid-cols-3">
      <Card className="p-5"><div className="flex justify-between"><span className="text-sm text-white/50">Pending transfers</span><Clock3 className="text-amber-300" size={19}/></div><div className="mt-4 text-3xl font-bold">0</div><p className="mt-2 text-xs text-white/40">Queue engine · Phase 3</p></Card>
      <Card className="p-5"><div className="flex justify-between"><span className="text-sm text-white/50">Paired contacts</span><Users className="text-cyan-300" size={19}/></div><div className="mt-4 text-3xl font-bold">0</div><p className="mt-2 text-xs text-white/40">Trusted pairing · Phase 2</p></Card>
      <Card className="p-5"><div className="flex justify-between"><span className="text-sm text-white/50">Received files</span><FolderDown className="text-violet-300" size={19}/></div><div className="mt-4 text-3xl font-bold">0</div><p className="mt-2 text-xs text-white/40">Inbox · Phase 1</p></Card>
    </section>
    <section className="grid gap-4 md:grid-cols-[1.3fr_1fr]"><Card className="p-6"><div className="flex items-center justify-between"><h3 className="font-bold">Getting started</h3><span className="text-xs text-violet-300">Step 1 of 3</span></div><div className="mt-6 space-y-5"><div className="flex gap-4"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300"><Check size={18}/></span><div><p className="font-medium">Register your device</p><p className="mt-1 text-xs text-white/45">A unique public key keeps your identity separate.</p></div></div><div className="flex gap-4"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/5 text-white/35">2</span><div><p className="font-medium text-white/65">Pair with another device</p><p className="mt-1 text-xs text-white/45">Coming in Phase 2: remote 6-digit pairing.</p></div></div><div className="flex gap-4"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/5 text-white/35">3</span><div><p className="font-medium text-white/65">Send anything</p><p className="mt-1 text-xs text-white/45">Phase 1 enables direct streaming transfer.</p></div></div></div></Card>
      <Card className="flex flex-col justify-between bg-[#192135] p-6"><div><div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-300"><Wifi/></div><h3 className="text-lg font-bold">Privacy first, always.</h3><p className="mt-3 text-sm leading-7 text-white/50">The future file transfer path will go directly between devices through WebRTC. Supabase will store only device metadata, pairing and signaling — never the file itself.</p></div><Link className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-violet-300" href="/settings">My device settings <ArrowUpRight size={15}/></Link></Card></section>
  </div>;
}
