-- PEND Phase 1 Sprint 1: one-use 6-digit transfer invitations.
-- No file bytes are stored in the database. No direct client table access.
create table if not exists public.transfer_rooms (
  id uuid primary key default gen_random_uuid(),
  sender_device_id uuid not null references public.devices(id) on delete cascade,
  receiver_device_id uuid references public.devices(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  receiver_user_id uuid references auth.users(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  joined_at timestamptz,
  check (receiver_device_id is null or receiver_device_id <> sender_device_id)
);
create index if not exists transfer_rooms_sender_idx on public.transfer_rooms(sender_user_id, created_at desc);
create index if not exists transfer_rooms_receiver_idx on public.transfer_rooms(receiver_user_id);
alter table public.transfer_rooms enable row level security;
revoke all on public.transfer_rooms from public, anon, authenticated;

-- Required to restrict online guesses of one million possible codes.
create table if not exists private.room_join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists room_join_attempts_user_idx on private.room_join_attempts(user_id,created_at desc);
revoke all on private.room_join_attempts from public, anon, authenticated;

create or replace function public.create_transfer_room(p_sender_device_id uuid,p_code_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_room_id uuid;
begin
  if auth.uid() is null or not private.owns_device(p_sender_device_id) then
    raise exception 'Not authorized for this device';
  end if;
  if p_code_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid code digest';
  end if;
  if (select count(*) from public.transfer_rooms where sender_user_id=auth.uid() and expires_at > now() and joined_at is null) >= 3 then
    raise exception 'Too many outstanding invitations';
  end if;
  insert into public.transfer_rooms(sender_device_id,sender_user_id,code_hash)
  values(p_sender_device_id,auth.uid(),p_code_hash) returning id into v_room_id;
  return v_room_id;
end $$;

create or replace function public.join_transfer_room(p_receiver_device_id uuid,p_code_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_room_id uuid;
begin
  if auth.uid() is null or not private.owns_device(p_receiver_device_id) then
    raise exception 'Not authorized for this device';
  end if;
  -- Serialize attempts for this user, even across multiple devices and tabs.
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  if (select count(*) from private.room_join_attempts
      where user_id=auth.uid() and created_at > now()-interval '10 minutes') >= 6 then
    raise exception 'Too many attempts. Try again in ten minutes.';
  end if;
  insert into private.room_join_attempts(user_id) values(auth.uid());
  update public.transfer_rooms
  set receiver_device_id=p_receiver_device_id, receiver_user_id=auth.uid(), joined_at=now()
  where code_hash=p_code_hash and expires_at > now() and joined_at is null
    and sender_user_id<>auth.uid()
  returning id into v_room_id;
  if v_room_id is null then
    raise exception 'Code is expired, used, or invalid';
  end if;
  return v_room_id;
end $$;

-- Only room participants may transmit or receive SDP/ICE broadcasts.
create or replace function private.is_transfer_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.transfer_rooms r
    where r.id=p_room_id
      and (r.sender_user_id=auth.uid() or r.receiver_user_id=auth.uid())
      and r.expires_at > now()
  )
$$;
revoke all on function private.is_transfer_room_member(uuid) from public,anon;
grant execute on function private.is_transfer_room_member(uuid) to authenticated;

-- Calls to realtime.topic() are validated before conversion to UUID.
create policy "pend room read signaling" on realtime.messages
for select to authenticated using (
 case when realtime.topic() ~ '^signaling:[0-9a-fA-F-]{36}$'
 then private.is_transfer_room_member(substring(realtime.topic() from 11)::uuid)
 else false end
);
create policy "pend room send signaling" on realtime.messages
for insert to authenticated with check (
 case when realtime.topic() ~ '^signaling:[0-9a-fA-F-]{36}$'
 then private.is_transfer_room_member(substring(realtime.topic() from 11)::uuid)
 else false end
);
revoke all on function public.create_transfer_room(uuid,text) from public,anon;
revoke all on function public.join_transfer_room(uuid,text) from public,anon;
grant execute on function public.create_transfer_room(uuid,text) to authenticated;
grant execute on function public.join_transfer_room(uuid,text) to authenticated;
