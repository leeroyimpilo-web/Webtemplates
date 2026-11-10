"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, CircleHelp, ContactRound, Home, Inbox, LoaderCircle, Send, Settings2, Wifi } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useDevice } from "@/components/device-provider";
import { Onboarding } from "@/components/onboarding";
import { TrustedReceiver } from "@/components/trusted-receiver";

const nav = [
  { href: "/", label: "Home", icon: Home },
  { href: "/contacts", label: "Contacts", icon: ContactRound },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/send", label: "Send", icon: Send },
  { href: "/settings", label: "Settings", icon: Settings2 },
];
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { device, phase, error, retry } = useDevice();
  if (phase === "loading") return <div role="status" className="flex min-h-svh items-center justify-center gap-3 text-white/65"><LoaderCircle className="animate-spin" />Setting up PEND…</div>;
  if (phase === "unconfigured") return <div className="mx-auto flex min-h-svh max-w-lg items-center px-6"><div className="w-full rounded-2xl border border-amber-400/25 bg-amber-400/5 p-8"><CircleHelp className="mb-5 text-amber-300" size={30}/><h1 className="text-2xl font-bold">Connect Supabase to start</h1><p className="mt-3 text-white/60">Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code>.env.local</code>, enable Anonymous Sign-Ins, and apply <code>supabase/schema.phase0.sql</code>.</p><p className="mt-5 text-xs text-white/40">PEND never sends file bytes to Supabase Storage.</p></div></div>;
  if (phase === "error") return <div className="mx-auto flex min-h-svh max-w-lg items-center px-6"><div className="rounded-2xl border border-rose-400/30 p-8"><h1 className="text-xl font-bold">Unable to connect</h1><p role="alert" className="mt-3 text-sm text-rose-200">{error}</p><Button className="mt-6" onClick={retry}>Try again</Button></div></div>;
  if (phase === "onboarding" || !device) return <Onboarding />;
  return <div className="min-h-svh bg-[#0d111d] text-white">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/10 bg-[#101523] p-5 md:flex">
      <Link href="/" className="mb-12 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-violet-500 text-xl font-extrabold">P.</span><span className="text-2xl font-bold tracking-tight">PEND<span className="text-violet-400">.</span></span></Link>
      <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-widest text-white/35">Workspace</p>
      <nav aria-label="Primary" className="space-y-1">{nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={cn("flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-white/60 transition hover:bg-white/5 hover:text-white", pathname === href && "bg-violet-500/15 text-violet-200")}><Icon size={19}/>{label}</Link>)}</nav>
      <div className="mt-auto rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-xs uppercase tracking-wider text-white/40">This device</p><p className="mt-2 truncate text-sm font-semibold">{device.device_name}</p><div className="mt-2 flex items-center gap-2 text-xs text-white/50"><span className="size-2 rounded-full bg-amber-400"/>Presence arrives in Phase 3</div></div>
    </aside>
    <div className="mx-auto max-w-6xl pb-24 md:ml-64 md:pb-0">
      <header className="sticky top-0 z-20 flex h-18 items-center justify-between border-b border-white/10 bg-[#0d111d]/90 px-5 backdrop-blur-lg sm:px-8">
        <Link href="/" className="text-xl font-extrabold md:hidden">PEND<span className="text-violet-400">.</span></Link>
        <span className="hidden text-xs font-medium text-white/40 md:block">SECURE DEVICE-TO-DEVICE SHARING</span>
        <div className="flex items-center gap-2"><span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/70"><Wifi className="mr-2 inline" size={14}/>{device.wifi_only ? "Wi-Fi preferred" : "Data allowed"}</span><span className="hidden text-xs text-white/45 sm:inline">{device.device_name}</span></div>
      </header>
      <main className="px-5 py-8 sm:px-8 md:py-10">{children}</main>
      <TrustedReceiver/><footer className="mx-5 mt-10 flex items-center justify-between border-t border-white/10 py-6 text-xs text-white/30 sm:mx-8"><span>© 2026 PEND · Phase 2 testing</span><a href="https://github.com" target="_blank" rel="noopener noreferrer">Source setup <ArrowUpRight size={11} className="inline"/></a></footer>
    </div>
    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-white/10 bg-[#101523]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">{nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={cn("flex min-h-17 flex-col items-center justify-center gap-1 text-[10px] text-white/45", pathname === href && "text-violet-300")}><Icon size={21}/>{label}</Link>)}</nav>
  </div>;
}
