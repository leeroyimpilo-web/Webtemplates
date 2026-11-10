-- PEND Phase 3: online heartbeats, per-device availability and durable METADATA queue.
-- File bytes are never inserted into Supabase (the sender retains the Blob in IndexedDB).
-- Browser heartbeat is best-effort and NOT a background service.

alter table public.devices
  add column if not exists availability_mode text not null default 'available'
    check (availability_mode in ('available','busy','invisible')),
  add column if not exists network_type text not null default 'unknown'
    check (network_type in ('wifi','ethernet','cellular','unknown')),
  add column if not exists download_on_data boolean not null default false;

grant update (availability_mode,download_on_data) on public.devices to authenticated;

create index if not exists devices_last_seen_idx on public.devices(last_seen);
create index if not exists transfers_pending_created_idx on public.transfers(receiver_device_id, status, created_at);

-- Clients cannot write last_seen or is_online directly; only authenticated device owners
-- may invoke this tiny RPC. Offline is derived from freshness, not a trusting bool alone.
create or replace function public.heartbeat_device(p_device_id uuid, p_network_type text default 'unknown')
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_time timestamptz;
begin
  if auth.uid() is null or not private.owns_device(p_device_id) then
    raise exception 'Unauthorized device';
  end if;
  if p_network_type not in ('wifi','ethernet','cellular','unknown') then
    p_network_type := 'unknown';
  end if;
  update public.devices
    set last_seen=now(), is_online=(availability_mode <> 'invisible'),
        is_available=(availability_mode = 'available'), network_type=p_network_type
    where id=p_device_id returning last_seen into v_time;
  return v_time;
end $$;

create or replace function public.queue_trusted_transfer(
  p_sender_device_id uuid, p_receiver_device_id uuid,
  p_file_name text, p_file_size bigint,
  p_file_type text default 'application/octet-stream', p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_transfer uuid;
begin
  if auth.uid() is null or not private.owns_device(p_sender_device_id) then
    raise exception 'Unauthorized device';
  end if;
  if p_sender_device_id = p_receiver_device_id or p_file_name is null
      or length(p_file_name) not between 1 and 255
      or p_file_size is null or p_file_size < 0 or p_file_size > 1099511627776 then
    raise exception 'Invalid file metadata';
  end if;
  if not exists (select 1 from public.pairings p where p.status='paired'
    and p.a_confirmed and p.b_confirmed and
      ((p.device_a_id=p_sender_device_id and p.device_b_id=p_receiver_device_id)
        or (p.device_b_id=p_sender_device_id and p.device_a_id=p_receiver_device_id))) then
    raise exception 'A mutually approved, active pairing is required';
  end if;
  if (select count(*) from public.transfers t
      where t.sender_device_id=p_sender_device_id and t.status in ('pending','connecting','transferring','paused')) >= 100 then
    raise exception 'Too many pending transfers';
  end if;
  insert into public.transfers(sender_device_id,receiver_device_id,file_name,file_size,file_type,
     note,status,total_chunks,chunk_size,auto_accept,expires_at)
  values(p_sender_device_id,p_receiver_device_id,p_file_name,p_file_size,
     left(coalesce(p_file_type,'application/octet-stream'),128),left(p_note,500),
     'pending',ceil(p_file_size::numeric/65536)::integer,65536,false,now()+interval '7 days')
  returning id into v_transfer;
  return v_transfer;
end $$;

-- Sender activates only when recipient is actually reachable / available according
-- to recent heartbeat and network preference. At most two live transfers per endpoint.
create or replace function public.activate_pending_transfer(p_sender_device_id uuid,p_transfer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_transfer public.transfers%rowtype; v_receiver public.devices%rowtype;
        v_sender public.devices%rowtype; v_room uuid; v_user uuid;
begin
  if auth.uid() is null or not private.owns_device(p_sender_device_id) then
    raise exception 'Unauthorized device';
  end if;
  select * into v_transfer from public.transfers
    where id=p_transfer_id and sender_device_id=p_sender_device_id for update;
  if not found or v_transfer.status <> 'pending' then return null; end if;
  if v_transfer.expires_at <= now() then
    update public.transfers set status='expired',updated_at=now() where id=p_transfer_id;
    return null;
  end if;
  select * into v_receiver from public.devices where id=v_transfer.receiver_device_id;
  select * into v_sender from public.devices where id=p_sender_device_id;
  if v_receiver.id is null or v_sender.id is null or
     v_receiver.last_seen is null or v_receiver.last_seen < now()-interval '40 seconds' or
     v_sender.last_seen is null or v_sender.last_seen < now()-interval '40 seconds' or
     not v_receiver.is_online or not v_sender.is_online or
     v_receiver.availability_mode <> 'available' or v_sender.availability_mode <> 'available' then
    return null;
  end if;
  if v_receiver.wifi_only and v_receiver.network_type not in ('wifi','ethernet')
      and not v_receiver.download_on_data then
    return null;
  end if;
  if not exists(select 1 from public.pairings p where p.status='paired' and p.a_confirmed and p.b_confirmed
    and ((p.device_a_id=p_sender_device_id and p.device_b_id=v_receiver.id)
      or (p.device_b_id=p_sender_device_id and p.device_a_id=v_receiver.id))) then
    return null;
  end if;
  if (select count(*) from public.transfers t where t.status in ('connecting','transferring')
      and (t.sender_device_id=p_sender_device_id or t.receiver_device_id=p_sender_device_id)) >= 2 then
    return null;
  end if;
  if (select count(*) from public.transfers t where t.status in ('connecting','transferring')
      and (t.sender_device_id=v_receiver.id or t.receiver_device_id=v_receiver.id)) >= 2 then
    return null;
  end if;
  -- Previous attempts may have expired; no open room can remain after parking.
  delete from public.transfer_rooms where transfer_id=p_transfer_id;
  v_user := v_receiver.user_id::uuid;
  insert into public.transfer_rooms(sender_device_id,receiver_device_id,sender_user_id,receiver_user_id,
        code_hash,transfer_id,expires_at,joined_at)
  values(p_sender_device_id,v_receiver.id,auth.uid(),v_user,null,p_transfer_id,now()+interval '20 minutes',now())
  returning id into v_room;
  update public.transfers set status='connecting',updated_at=now()
    where id=p_transfer_id;
  return jsonb_build_object('room_id',v_room,'transfer_id',p_transfer_id);
end $$;

create or replace function public.park_pending_transfer(p_sender_device_id uuid,p_transfer_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  if auth.uid() is null or not private.owns_device(p_sender_device_id) then
    raise exception 'Unauthorized device';
  end if;
  update public.transfers set status='pending',updated_at=now()
    where id=p_transfer_id and sender_device_id=p_sender_device_id
      and status in ('connecting','transferring','paused')
  returning true into v_ok;
  if coalesce(v_ok,false) then
    delete from public.transfer_rooms where transfer_id=p_transfer_id;
  end if;
  return coalesce(v_ok,false);
end $$;

-- Only the receiving device can assert durable-byte progress. The value is derived
-- from flushed OPFS writes; it must be monotonic and cannot exceed the file size.
create or replace function public.record_received_bytes(p_receiver_device_id uuid,p_transfer_id uuid,p_bytes bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  if auth.uid() is null or not private.owns_device(p_receiver_device_id) then
    raise exception 'Unauthorized device';
  end if;
  update public.transfers set bytes_transferred=p_bytes,status='transferring',updated_at=now()
  where id=p_transfer_id and receiver_device_id=p_receiver_device_id
    and status in ('connecting','transferring') and p_bytes >= bytes_transferred and p_bytes <= file_size
  returning true into v_ok;
  return coalesce(v_ok,false);
end $$;

-- Receiver marks complete only after the file was closed and indexed in OPFS.
create or replace function public.complete_received_transfer(p_receiver_device_id uuid,p_transfer_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  if auth.uid() is null or not private.owns_device(p_receiver_device_id) then
    raise exception 'Unauthorized device';
  end if;
  update public.transfers set status='completed',bytes_transferred=file_size,updated_at=now()
  where id=p_transfer_id and receiver_device_id=p_receiver_device_id
     and status in ('connecting','transferring')
  returning true into v_ok;
  return coalesce(v_ok,false);
end $$;

create or replace function public.cancel_queued_transfer(p_my_device_id uuid,p_transfer_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  if auth.uid() is null or not private.owns_device(p_my_device_id) then
    raise exception 'Unauthorized device';
  end if;
  update public.transfers set status='cancelled',updated_at=now()
  where id=p_transfer_id and p_my_device_id in (sender_device_id,receiver_device_id)
    and status not in ('completed','cancelled','expired')
  returning true into v_ok;
  if coalesce(v_ok,false) then
    delete from public.transfer_rooms where transfer_id=p_transfer_id;
  end if;
  return coalesce(v_ok,false);
end $$;

-- Recover a transfer after the sender browser is closed or killed. Only transfer
-- sessions without progress/updates for 3 minutes are eligible to prevent stealing
-- an active session from another sender tab.
create or replace function public.recover_abandoned_transfer(p_sender_device_id uuid,p_transfer_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  if auth.uid() is null or not private.owns_device(p_sender_device_id) then
    raise exception 'Unauthorized device';
  end if;
  update public.transfers set status='pending',updated_at=now()
   where id=p_transfer_id and sender_device_id=p_sender_device_id
     and status in ('connecting','transferring','paused')
     and updated_at < now()-interval '3 minutes'
   returning true into v_ok;
  if coalesce(v_ok,false) then
    delete from public.transfer_rooms where transfer_id=p_transfer_id;
  end if;
  return coalesce(v_ok,false);
end $$;

revoke all on function public.heartbeat_device(uuid,text) from public,anon;
revoke all on function public.queue_trusted_transfer(uuid,uuid,text,bigint,text,text) from public,anon;
revoke all on function public.activate_pending_transfer(uuid,uuid) from public,anon;
revoke all on function public.park_pending_transfer(uuid,uuid) from public,anon;
revoke all on function public.record_received_bytes(uuid,uuid,bigint) from public,anon;
revoke all on function public.complete_received_transfer(uuid,uuid) from public,anon;
revoke all on function public.cancel_queued_transfer(uuid,uuid) from public,anon;
revoke all on function public.recover_abandoned_transfer(uuid,uuid) from public,anon;
grant execute on function public.heartbeat_device(uuid,text) to authenticated;
grant execute on function public.queue_trusted_transfer(uuid,uuid,text,bigint,text,text) to authenticated;
grant execute on function public.activate_pending_transfer(uuid,uuid) to authenticated;
grant execute on function public.park_pending_transfer(uuid,uuid) to authenticated;
grant execute on function public.record_received_bytes(uuid,uuid,bigint) to authenticated;
grant execute on function public.complete_received_transfer(uuid,uuid) to authenticated;
grant execute on function public.cancel_queued_transfer(uuid,uuid) to authenticated;
grant execute on function public.recover_abandoned_transfer(uuid,uuid) to authenticated;

do $$ begin
 if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='devices') then
    alter publication supabase_realtime add table public.devices;
 end if;
end $$;
