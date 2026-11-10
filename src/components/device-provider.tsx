"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { getOrCreateDeviceId, getOrCreateIdentity, inferPlatform } from "@/lib/identity";
import type { DeviceRecord } from "@/lib/types";

type Phase = "loading" | "unconfigured" | "onboarding" | "ready" | "error";
interface DeviceContextValue {
  phase: Phase;
  device: DeviceRecord | null;
  error: string | null;
  registerDevice: (name: string) => Promise<void>;
  updatePreferences: (values: Partial<Pick<DeviceRecord, "is_available" | "wifi_only">>) => Promise<void>;
  retry: () => void;
}
const DeviceContext = createContext<DeviceContextValue | null>(null);

async function ensureAnonymousUser(client: SupabaseClient): Promise<string> {
  const { data: { session }, error } = await client.auth.getSession();
  if (error) throw error;
  if (session?.user.id) return session.user.id;
  const created = await client.auth.signInAnonymously();
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("Anonymous sign-in was not enabled in Supabase.");
  }
  return created.data.user.id;
}

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [device, setDevice] = useState<DeviceRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const client = getSupabase();
      if (!client) { setPhase("unconfigured"); return; }
      try {
        const userId = await ensureAnonymousUser(client);
        const deviceId = getOrCreateDeviceId();
        const query = await client.from("devices").select("*").eq("id", deviceId).maybeSingle();
        if (query.error) throw query.error;
        if (cancelled) return;
        if (query.data && query.data.user_id !== userId) {
          throw new Error("Device ID belongs to another account. Restore the original browser profile; do not clear your local keys.");
        }
        setDevice((query.data as DeviceRecord | null) ?? null);
        setPhase(query.data ? "ready" : "onboarding");
        setError(null);
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setPhase("error"); }
      }
    }
    void boot();
    return () => { cancelled = true; };
  }, [attempt]);

  const registerDevice = useCallback(async (name: string) => {
    const client = getSupabase();
    if (!client) throw new Error("Supabase environment is not configured.");
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 48) throw new Error("Use a device name between 2 and 48 characters.");
    try {
      const userId = await ensureAnonymousUser(client);
      const identity = await getOrCreateIdentity();
      const row = {
        id: getOrCreateDeviceId(),
        user_id: userId,
        device_name: trimmed,
        device_fingerprint: identity.fingerprint,
        public_key: identity.publicKey,
        platform: inferPlatform(),
        is_online: false,      // Phase 3 heartbeat only. Never fabricate presence.
        is_available: true,
        wifi_only: true,
      };
      const response = await client.from("devices").insert(row).select("*").single();
      if (response.error) throw response.error;
      setDevice(response.data as DeviceRecord);
      setPhase("ready");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, []);

  const updatePreferences = useCallback(async (values: Partial<Pick<DeviceRecord, "is_available" | "wifi_only">>) => {
    if (!device) return;
    const client = getSupabase();
    if (!client) throw new Error("Supabase unavailable");
    const res = await client.from("devices").update(values).eq("id", device.id).select("*").single();
    if (res.error) throw res.error;
    setDevice(res.data as DeviceRecord);
  }, [device]);

  const value = useMemo(() => ({
    phase, device, error, registerDevice, updatePreferences, retry: () => setAttempt((n) => n + 1),
  }), [phase, device, error, registerDevice, updatePreferences]);
  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice(): DeviceContextValue {
  const value = useContext(DeviceContext);
  if (!value) throw new Error("useDevice must be inside DeviceProvider");
  return value;
}
