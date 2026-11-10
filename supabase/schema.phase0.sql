-- PEND Phase 0: device identity and future transfer metadata.
-- Apply only to a dedicated project with anonymous sign-ins enabled.
-- No Supabase Storage buckets are created; browser writes of pairing codes are denied.

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.devices (
  id uuid primary key,
  user_id text not null default (auth.uid())::text,
  device_name text not null check (char_length(device_name) between 2 and 48),
  device_fingerprint text unique not null check (device_fingerprint ~ '^[a-f0-9]{64}$'),
  public_key text not null,
  platform text not null,
  last_seen timestamptz,
  is_online boolean not null default false,
  is_available boolean not null default true,
  wifi_only boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.pairings (
  id uuid primary key default gen_random_uuid(),
  device_a_id uuid not null references public.devices(id) on delete cascade,
  device_b_id uuid not null references public.devices(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','paired','revoked')),
  pairing_code_hash text,
  code_expires_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (device_a_id <> device_b_id)
);
-- Unique unordered pair: (A,B) and (B,A) cannot both exist.
create unique index if not exists pairings_canonical_pair_unique
  on public.pairings (least(device_a_id,device_b_id), greatest(device_a_id,device_b_id));

create table if not exists public.pairing_codes (
  code_hash text primary key check (code_hash ~ '^[a-f0-9]{64}$'),
  requester_device_id uuid not null references public.devices(id) on delete cascade,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  sender_device_id uuid not null references public.devices(id) on delete cascade,
  receiver_device_id uuid not null references public.devices(id) on delete cascade,
  file_name text not null,
  file_size bigint not null check (file_size >= 0),
  file_type text,
  file_hash text,
  status text not null default 'pending' check (status in (
    'pending','connecting','transferring','paused','completed','failed','expired','cancelled'
  )),
  bytes_transferred bigint not null default 0 check (bytes_transferred >= 0 and bytes_transferred <= file_size),
  total_chunks integer check (total_chunks is null or total_chunks >= 0),
  chunk_size integer not null default 65536 check (chunk_size = 65536),
  note text,
  auto_accept boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sender_device_id <> receiver_device_id)
);

create table if not exists public.transfer_requests (
  id uuid primary key default gen_random_uuid(),
  requester_device_id uuid not null references public.devices(id) on delete cascade,
  target_device_id uuid not null references public.devices(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending','fulfilled','declined')),
  created_at timestamptz not null default now(),
  check (requester_device_id <> target_device_id)
);

create index if not exists devices_user_idx on public.devices(user_id);
create index if not exists transfers_sender_created_idx on public.transfers(sender_device_id,created_at desc);
create index if not exists transfers_receiver_status_idx on public.transfers(receiver_device_id,status);
create index if not exists transfer_requests_target_idx on public.transfer_requests(target_device_id);
create index if not exists pairing_codes_requester_idx on public.pairing_codes(requester_device_id);

-- Security-definer helpers are in a NON-exposed schema; each checks the authenticated UID.
-- These functions avoid recursive RLS between devices and pairings.
create or replace function private.owns_device(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.devices d
    where d.id=p_id and d.user_id=(select auth.uid())::text
  )
$$;
create or replace function private.may_view_device(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    exists (select 1 from public.devices d where d.id=p_id and d.user_id=(select auth.uid())::text)
    or exists (
      select 1 from public.pairings p
      join public.devices mine on mine.id in (p.device_a_id,p.device_b_id)
      where p.status='paired'
        and p_id in (p.device_a_id,p.device_b_id)
        and mine.id <> p_id and mine.user_id=(select auth.uid())::text
    )
  )
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.owns_device(uuid) to authenticated;
grant execute on function private.may_view_device(uuid) to authenticated;

alter table public.devices enable row level security;
alter table public.pairings enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_requests enable row level security;

create policy "own or trusted device read" on public.devices
  for select to authenticated using (private.may_view_device(id));
create policy "device create for self" on public.devices
  for insert to authenticated with check (user_id = (select auth.uid())::text and is_online = false);
create policy "device owner update" on public.devices
  for update to authenticated
  using (user_id = (select auth.uid())::text)
  with check (user_id = (select auth.uid())::text);

create policy "pair participants can read" on public.pairings
  for select to authenticated
  using (private.owns_device(device_a_id) or private.owns_device(device_b_id));
-- Pairings INSERT/UPDATE/DELETE intentionally blocked until protected Phase 2 RPC.
-- Pairing code hash never readable or writable directly by a browser.

create policy "transfer participants can read" on public.transfers
  for select to authenticated
  using (private.owns_device(sender_device_id) or private.owns_device(receiver_device_id));
-- Transfer state mutations require Phase 1/3 protocol-authorized RPCs.

create policy "request participants can read" on public.transfer_requests
  for select to authenticated
  using (private.owns_device(requester_device_id) or private.owns_device(target_device_id));

-- Data API access grants are separate from RLS policies.
revoke all on public.pairing_codes from anon, authenticated;
grant select, insert on public.devices to authenticated;
-- Only settings may be changed from the browser; no forged heartbeat/key replacement.
grant update (is_available, wifi_only) on public.devices to authenticated;
grant select on public.pairings, public.transfers, public.transfer_requests to authenticated;
revoke all on public.devices, public.pairings, public.transfers, public.transfer_requests from anon;

-- Make all rows private by default. In Phase 1, explicitly design/authorize
-- Supabase Realtime signaling channels and publication settings.

-- Index both pair membership FKs and requester FK; aids joins and cascade deletes.
create index if not exists pairings_device_a_idx on public.pairings(device_a_id);
create index if not exists pairings_device_b_idx on public.pairings(device_b_id);
create index if not exists transfer_requests_requester_idx on public.transfer_requests(requester_device_id);
