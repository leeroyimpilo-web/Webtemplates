-- PEND Phase 2: remote six-digit pairing and guarded trusted-transfer invitations.
-- File bytes never enter PostgreSQL, Realtime, or Supabase Storage.
-- Pairings require explicit YES from BOTH authenticated device owners.
-- The public RPC surface checks auth.uid() and owns_device on every mutation.

alter table public.pairings
  add column if not exists a_confirmed boolean not null default false,
  add column if not exists b_confirmed boolean not null default false;

-- A receiver is allowed to see the peer's PUBLIC identity while confirming a
-- pending pairing. Revoked pairs no longer grant any peer device visibility.
create or replace function private.may_view_device(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists (select 1 from public.devices d
      where d.id = p_id and d.user_id = auth.uid()::text)
    or exists (
      select 1 from public.pairings p
      join public.devices mine
        on mine.id in (p.device_a_id, p.device_b_id)
      where p.status in ('pending','paired')
        and p_id in (p.device_a_id, p.device_b_id)
        and mine.id <> p_id and mine.user_id = auth.uid()::text
    )
  )
$$;

create table if not exists private.pairing_join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists pairing_join_attempts_by_user
  on private.pairing_join_attempts(user_id, created_at desc);
revoke all on private.pairing_join_attempts from public, anon, authenticated;

create or replace function public.create_pairing_code(p_requester_device_id uuid, p_code_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.owns_device(p_requester_device_id) then
    raise exception 'Not authorized for this device';
  end if;
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  if (select count(*) from public.pairing_codes c
      join public.devices d on d.id=c.requester_device_id
      where d.user_id=auth.uid()::text and c.expires_at>now() and not c.used) >= 3 then
    return false;
  end if;
  -- Digest collisions or another user's active code fail closed.
  insert into public.pairing_codes(code_hash, requester_device_id, expires_at)
  values(p_code_hash, p_requester_device_id, now() + interval '10 minutes')
  on conflict (code_hash) do nothing;
  return found;
end $$;

create or replace function public.join_pairing_code(p_joiner_device_id uuid, p_code_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_sender uuid; v_pair uuid;
begin
  if auth.uid() is null or not private.owns_device(p_joiner_device_id) then
    raise exception 'Not authorized for this device';
  end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  if (select count(*) from private.pairing_join_attempts a
        where a.user_id=auth.uid() and a.created_at>now()-interval '10 minutes') >= 6 then
    return null;
  end if;
  -- Count unsuccessful guesses without raising an exception/rolling back.
  insert into private.pairing_join_attempts(user_id) values(auth.uid());
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then return null; end if;
  select c.requester_device_id into v_sender
    from public.pairing_codes c
    where c.code_hash=p_code_hash and c.expires_at>now() and not c.used
    for update;
  if v_sender is null or v_sender=p_joiner_device_id then return null; end if;
  select p.id into v_pair from public.pairings p
   where least(p.device_a_id,p.device_b_id)=least(v_sender,p_joiner_device_id)
     and greatest(p.device_a_id,p.device_b_id)=greatest(v_sender,p_joiner_device_id)
   for update;
  if v_pair is not null and (select p.status from public.pairings p where p.id=v_pair) <> 'revoked' then
    return null;
  end if;
  update public.pairing_codes set used=true
    where code_hash=p_code_hash and not used and expires_at>now();
  if not found then return null; end if;
  if v_pair is null then
    insert into public.pairings(device_a_id,device_b_id,status,code_expires_at,a_confirmed,b_confirmed)
    values(v_sender,p_joiner_device_id,'pending',now()+interval '10 minutes',false,false)
    returning id into v_pair;
  else
    update public.pairings
      set device_a_id=v_sender,device_b_id=p_joiner_device_id,status='pending',
          code_expires_at=now()+interval '10 minutes',
          a_confirmed=false,b_confirmed=false,revoked_at=null,pairing_code_hash=null
      where id=v_pair;
  end if;
  return v_pair;
end $$;

create or replace function public.confirm_pairing(p_pairing_id uuid, p_my_device_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_pair public.pairings%rowtype;
begin
  if auth.uid() is null or not private.owns_device(p_my_device_id) then
    raise exception 'Not authorized for this device';
  end if;
  select * into v_pair from public.pairings where id=p_pairing_id for update;
  if not found or p_my_device_id not in (v_pair.device_a_id, v_pair.device_b_id) then
    raise exception 'Pairing not found';
  end if;
  if v_pair.status <> 'pending' then return v_pair.status; end if;
  if v_pair.code_expires_at < now() then
    update public.pairings set status='revoked', revoked_at=now(), a_confirmed=false, b_confirmed=false
      where id=p_pairing_id;
    return 'revoked';
  end if;
  if not coalesce(p_accept,false) then
    update public.pairings set status='revoked', revoked_at=now(), a_confirmed=false, b_confirmed=false
      where id=p_pairing_id;
    return 'revoked';
  end if;
  if p_my_device_id = v_pair.device_a_id then
    update public.pairings set a_confirmed=true where id=p_pairing_id;
  else
    update public.pairings set b_confirmed=true where id=p_pairing_id;
  end if;
  update public.pairings set status='paired'
    where id=p_pairing_id and status='pending' and a_confirmed and b_confirmed;
  return (select status from public.pairings where id=p_pairing_id);
end $$;

create or replace function public.revoke_pairing(p_pairing_id uuid, p_my_device_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.owns_device(p_my_device_id) then
    raise exception 'Not authorized for this device';
  end if;
  update public.pairings set status='revoked',revoked_at=now(),a_confirmed=false,b_confirmed=false
  where id=p_pairing_id and p_my_device_id in (device_a_id,device_b_id)
    and status <> 'revoked';
  return found;
end $$;

-- Trusted transfer metadata and explicitly addressed channel; no 6-digit code
-- or manual join is needed because the pair's authorization is checked server-side.
alter table public.transfer_rooms alter column code_hash drop not null;
alter table public.transfer_rooms add column if not exists transfer_id uuid unique references public.transfers(id) on delete cascade;

create or replace function public.create_trusted_transfer(
  p_sender_device_id uuid,p_receiver_device_id uuid,
  p_file_name text,p_file_size bigint,p_file_type text default 'application/octet-stream',
  p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_transfer uuid; v_room uuid;
begin
  if auth.uid() is null or not private.owns_device(p_sender_device_id) then
    raise exception 'Not authorized for this device';
  end if;
  if p_sender_device_id=p_receiver_device_id or
    p_file_name is null or length(p_file_name) not between 1 and 255 or
    p_file_size is null or p_file_size < 0 or p_file_size > 1099511627776 then
    raise exception 'Invalid file metadata';
  end if;
  if not exists(select 1 from public.pairings p where p.status='paired' and
    ((p.device_a_id=p_sender_device_id and p.device_b_id=p_receiver_device_id) or
     (p.device_b_id=p_sender_device_id and p.device_a_id=p_receiver_device_id))) then
    raise exception 'Both devices must be paired and not revoked';
  end if;
  select d.user_id::uuid into v_user from public.devices d where d.id=p_receiver_device_id;
  if v_user is null then raise exception 'Receiver device missing'; end if;
  insert into public.transfers(sender_device_id,receiver_device_id,file_name,file_size,file_type,
      note,status,total_chunks,chunk_size,auto_accept,expires_at)
  values(p_sender_device_id,p_receiver_device_id,p_file_name,p_file_size,
     left(coalesce(p_file_type,'application/octet-stream'),128), left(p_note,500),
     'connecting',ceil(p_file_size::numeric/65536)::integer,65536,false,now()+interval '20 minutes')
  returning id into v_transfer;
  insert into public.transfer_rooms(sender_device_id,receiver_device_id,sender_user_id,
     receiver_user_id,code_hash,transfer_id,expires_at,joined_at)
  values(p_sender_device_id,p_receiver_device_id,auth.uid(),v_user,null,v_transfer,
    now()+interval '20 minutes',now())
  returning id into v_room;
  return jsonb_build_object('transfer_id',v_transfer,'room_id',v_room);
end $$;

create or replace function public.get_trusted_transfer_room(p_transfer_id uuid, p_my_device_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_room record;
begin
  if auth.uid() is null or not private.owns_device(p_my_device_id) then
    raise exception 'Not authorized for this device';
  end if;
  select r.id as room_id,t.sender_device_id,t.file_name,t.file_size,t.file_type,
    t.receiver_device_id,t.id as transfer_id
  into v_room from public.transfers t join public.transfer_rooms r on r.transfer_id=t.id
  where t.id=p_transfer_id and t.receiver_device_id=p_my_device_id
    and t.status='connecting' and r.expires_at>now() and r.receiver_user_id=auth.uid()
    and exists(select 1 from public.pairings p where p.status='paired' and
       ((p.device_a_id=t.sender_device_id and p.device_b_id=t.receiver_device_id) or
        (p.device_b_id=t.sender_device_id and p.device_a_id=t.receiver_device_id)));
  if not found then return null; end if;
  return jsonb_build_object('room_id',v_room.room_id,'transfer_id',v_room.transfer_id,
    'sender_device_id',v_room.sender_device_id,'file_name',v_room.file_name,
    'file_size',v_room.file_size,'file_type',v_room.file_type);
end $$;

-- RPC functions are callable only after authenticated UID + device ownership checks.
revoke all on function public.create_pairing_code(uuid,text) from public,anon;
revoke all on function public.join_pairing_code(uuid,text) from public,anon;
revoke all on function public.confirm_pairing(uuid,uuid,boolean) from public,anon;
revoke all on function public.revoke_pairing(uuid,uuid) from public,anon;
revoke all on function public.create_trusted_transfer(uuid,uuid,text,bigint,text,text) from public,anon;
revoke all on function public.get_trusted_transfer_room(uuid,uuid) from public,anon;
grant execute on function public.create_pairing_code(uuid,text) to authenticated;
grant execute on function public.join_pairing_code(uuid,text) to authenticated;
grant execute on function public.confirm_pairing(uuid,uuid,boolean) to authenticated;
grant execute on function public.revoke_pairing(uuid,uuid) to authenticated;
grant execute on function public.create_trusted_transfer(uuid,uuid,text,bigint,text,text) to authenticated;
grant execute on function public.get_trusted_transfer_room(uuid,uuid) to authenticated;

-- Stream metadata updates only, with existing per-user RLS filtering.
do $$ begin
 if not exists(select 1 from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename='pairings') then
   alter publication supabase_realtime add table public.pairings;
 end if;
 if not exists(select 1 from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename='transfers') then
   alter publication supabase_realtime add table public.transfers;
 end if;
end $$;
