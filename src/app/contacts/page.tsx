import { ContactRound, LockKeyhole } from "lucide-react";
import { Card } from "@/components/ui/card";
export const metadata = { title: "Contacts" };
export default function ContactsPage() {
  return <div className="space-y-7"><div><p className="text-xs font-bold uppercase tracking-[0.25em] text-violet-300">YOUR TRUSTED CIRCLE</p><h1 className="mt-2 text-3xl font-bold">Contacts</h1><p className="mt-2 text-white/50">Only paired devices will appear here.</p></div><Card className="flex min-h-80 flex-col items-center justify-center p-8 text-center"><span className="mb-5 grid size-17 place-items-center rounded-2xl bg-violet-400/10 text-violet-300"><ContactRound size={32}/></span><h2 className="text-lg font-semibold">No contacts paired yet</h2><p className="mt-2 max-w-sm text-sm leading-6 text-white/45">A one-time code, QR pairing, confirm on both devices, and trusted auto-receive will be implemented in Phase 2.</p><span className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-white/55"><LockKeyhole size={14}/> Pairing unavailable in Phase 0</span></Card></div>;
}
