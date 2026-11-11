"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckSquare2, FolderPlus, UsersRound, Trash2, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { db, type LocalGroup } from "@/lib/db";
import { getPairingContacts, isTrustedLocally, type PairingContact } from "@/lib/pairing";
import { useDevice } from "@/components/device-provider";
import { getSupabase } from "@/lib/supabase";
import { queueTrustedFile } from "@/lib/queue";

export default function GroupsPage() {
  const { device } = useDevice();
  const [groups, setGroups] = useState<LocalGroup[]>([]);
  const [contacts, setContacts] = useState<PairingContact[]>([]);
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setGroups(await db.groups.orderBy("updatedAt").reverse().toArray());
    const client = getSupabase();
    if (!device || !client) return;
    const trusted = (await getPairingContacts(client, device.id)).filter(c => c.pairing.status === "paired");
    const confirmed = (await Promise.all(trusted.map(async c => await isTrustedLocally(c.peer) ? c : null)))
      .filter((c): c is PairingContact => c !== null);
    setContacts(confirmed);
  }, [device]);
  useEffect(() => { void refresh().catch(e=>setError(String(e))); }, [refresh]);

  const create = async () => {
    const name = groupName.trim();
    if (name.length < 2 || name.length > 60) { setError("Group name must be 2–60 characters."); return; }
    if (selected.length === 0) { setError("Choose at least one trusted contact."); return; }
    setBusy(true); setError("");
    try {
      const time = Date.now();
      const group = { id: crypto.randomUUID(), name, memberDeviceIds: [...new Set(selected)], createdAt: time, updatedAt: time };
      await db.groups.put(group);
      setGroupName(""); setSelected([]); setActiveId(group.id); await refresh();
      setFeedback(`Created ${name}. Group membership stays on this device.`);
    } catch(e) { setError(String(e)); } finally { setBusy(false); }
  };

  const send = async () => {
    const group = groups.find(g => g.id === activeId);
    const client = getSupabase();
    if (!client || !device || !group || !file || busy) return;
    setBusy(true); setError(""); setFeedback("");
    let queued = 0; const failures: string[] = [];
    try {
      const current = (await getPairingContacts(client, device.id)).filter(c => c.pairing.status === "paired");
      for (const receiver of group.memberDeviceIds) {
        const contact = current.find(c => c.peer.id === receiver);
        if (!contact || !await isTrustedLocally(contact.peer)) {
          failures.push(`${contacts.find(c=>c.peer.id===receiver)?.peer.device_name ?? receiver}: no longer trusted`);
          continue;
        }
        try { await queueTrustedFile(client, device.id, receiver, file); queued++; }
        catch(e) { failures.push(`${contact.peer.device_name}: ${e instanceof Error ? e.message : "failed"}`); }
      }
      setFeedback(`Queued ${queued} separate encrypted transfer${queued===1?'':'s'}. Online peers receive first; offline peers remain Pending while the sender retains the files.`);
      if (failures.length) setError(failures.join("; "));
    } finally { setBusy(false); }
  };

  const remove = async (g:LocalGroup) => {
    await db.groups.delete(g.id);
    if (activeId===g.id) setActiveId("");
    await refresh();
  };

  return <div className="space-y-7">
    <header><p className="text-xs font-bold tracking-[.2em] text-violet-300">PHASE 4 · GROUP SEND</p>
      <h1 className="mt-2 text-3xl font-bold">Groups</h1>
      <p className="mt-2 text-sm text-white/60">Save a family or team group. One tap queues a separate protected file transfer for each confirmed contact.</p></header>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-4 p-6"><div className="flex items-center gap-2 font-bold"><FolderPlus size={20}/> Create group</div>
        <input className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-sm" value={groupName} maxLength={60}
          onChange={e=>setGroupName(e.target.value)} placeholder="e.g. Family" aria-label="New group name"/>
        {contacts.length ? contacts.map(contact=><label key={contact.peer.id} className="flex cursor-pointer gap-3 rounded-xl border border-white/10 p-3 text-sm">
          <input type="checkbox" checked={selected.includes(contact.peer.id)} onChange={e=>setSelected(prev=>e.target.checked ? [...prev,contact.peer.id] : prev.filter(x=>x!==contact.peer.id))}/>
          <span className="flex-1">{contact.peer.device_name}</span><CheckSquare2 size={16} className="text-emerald-300"/></label>) : <p className="text-sm text-white/50">Pair and confirm devices in Contacts first.</p>}
        <Button disabled={busy||!contacts.length} onClick={()=>void create()}>Save group</Button>
      </Card>
      <Card className="space-y-4 p-6"><div className="flex items-center gap-2 font-bold"><UsersRound size={20}/> Send to a group</div>
        <select className="w-full rounded-xl border border-white/15 bg-[#1b2437] p-3 text-sm" value={activeId} onChange={e=>setActiveId(e.target.value)} aria-label="Choose group">
          <option value="">Select group</option>{groups.map(g=><option value={g.id} key={g.id}>{g.name} ({g.memberDeviceIds.length})</option>)}
        </select>
        <input ref={input} className="sr-only" type="file" onChange={e=>setFile(e.target.files?.[0]??null)}/>
        <Button variant="secondary" onClick={()=>input.current?.click()}><Upload size={16}/> {file? file.name : "Choose file"}</Button>
        <Button disabled={!file||!activeId||busy} onClick={()=>void send()}>{busy?"Queueing…":"Send to all group members"}</Button>
        <p className="text-xs text-white/40">Group membership is local to this browser; queued transfer metadata is stored securely in Supabase, not file bytes.</p>
      </Card>
    </div>
    {feedback&&<p className="rounded-xl bg-emerald-400/10 p-3 text-sm text-emerald-200" role="status">{feedback}</p>}
    {error&&<p className="rounded-xl bg-rose-400/10 p-3 text-sm text-rose-200" role="alert">{error}</p>}
    <Card className="space-y-3 p-6"><h2 className="font-semibold">Saved groups</h2>
      {groups.map(g=><div key={g.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3">
        <div><p className="font-semibold">{g.name}</p><p className="text-xs text-white/45">{g.memberDeviceIds.length} trusted members at creation</p></div>
        <Button size="sm" variant="outline" onClick={()=>void remove(g)}><Trash2 size={14}/> Delete</Button></div>)}
      {!groups.length&&<p className="text-sm text-white/50">No groups yet.</p>}
    </Card>
  </div>;
}
