import { FolderOpen, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
export const metadata = { title: "Inbox" };
export default function InboxPage() {
  return <div className="space-y-7"><div><p className="text-xs font-bold uppercase tracking-[0.25em] text-violet-300">YOUR RECEIVED FILES</p><h1 className="mt-2 text-3xl font-bold">Inbox</h1><p className="mt-2 text-white/50">Downloads will stay on this device.</p></div><Card className="flex min-h-80 flex-col items-center justify-center p-8 text-center"><span className="mb-5 grid size-17 place-items-center rounded-2xl bg-cyan-300/10 text-cyan-300"><FolderOpen size={32}/></span><h2 className="text-lg font-semibold">Your inbox is empty</h2><p className="mt-2 max-w-sm text-sm leading-6 text-white/45">When direct P2P transfers are enabled in Phase 1, files received locally will appear here. We never upload them to a server.</p><span className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-xs text-white/55"><ShieldCheck size={14}/> No Supabase file storage</span></Card></div>;
}
