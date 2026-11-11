-- PEND Phase 4 Sprint 7: request a file. Files never enter Postgres or Supabase Storage.
-- Existing public.transfer_requests is participant-readable only and has no browser writes.
alter table public.transfers add column if not exists request_id uuid
  references public.transfer_requests(id) on delete set null;
create unique index if not exists transfers_request_unique
  on public.transfers(request_id) where request_id is not null and status <> 'cancelled';

-- Sender of a request must own its device and have a mutually approved, active pairing.
create or replace function public.create_file_request(
  p_requester_device_id uuid, p_target_device_id uuid, p_message text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not private.owns_device(p_requester_device_id)
     or p_requester_device_id = p_target_device_id then
    raise exception 'Unauthorized file request';
  end if;
  if p_message is null or length(trim(p_message)) not between 1 and 500 then
    raise exception 'Request message must be 1-500 characters';
  end if;
  if not exists (select 1 from public.pairings p where p.status='paired'
      and p.a_confirmed and p.b_confirmed
      and ((p.device_a_id=p_requester_device_id and p.device_b_id=p_target_device_id)
      or (p.device_b_id=p_requester_device_id and p.device_a_id=p_target_device_id))) then
    raise exception 'A mutually approved pairing is required';
  end if;
  if (select count(*) from public.transfer_requests r where
      r.requester_device_id=p_requester_device_id and r.created_at>now()-interval '24 hours') >= 30 then
    raise exception 'Daily request limit reached';
  end if;
  insert into public.transfer_requests(requester_device_id,target_device_id,message,status)
    values (p_requester_device_id,p_target_device_id,trim(p_message),'pending') returning id into v_id;
  return v_id;
end $$;

create or replace function public.decline_file_request(p_target_device_id uuid,p_request_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_success boolean;
begin
  if auth.uid() is null or not private.owns_device(p_target_device_id) then
    raise exception 'Unauthorized device';
  end if;
  update public.transfer_requests set status='declined'
    where id=p_request_id and target_device_id=p_target_device_id and status='pending'
    returning true into v_success;
  return coalesce(v_success,false);
end $$;

-- Queue a requested file by the TARGET device, addressed back to requester.
-- All checks are server side: requester cannot impersonate a target or force a response.
create or replace function public.fulfill_file_request(
  p_target_device_id uuid,p_request_id uuid,p_file_name text,p_file_size bigint,
  p_file_type text default 'application/octet-stream')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_request public.transfer_requests%rowtype; v_id uuid;
begin
  if auth.uid() is null or not private.owns_device(p_target_device_id) then
    raise exception 'Unauthorized device';
  end if;
  select * into v_request from public.transfer_requests
    where id=p_request_id and target_device_id=p_target_device_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'File request is not pending';
  end if;
  if p_file_name is null or length(p_file_name) not between 1 and 255 or
     p_file_size is null or p_file_size < 0 or p_file_size > 1099511627776 then
    raise exception 'Invalid file metadata';
  end if;
  if not exists (select 1 from public.pairings p where p.status='paired'
      and p.a_confirmed and p.b_confirmed
      and ((p.device_a_id=p_target_device_id and p.device_b_id=v_request.requester_device_id)
      or (p.device_b_id=p_target_device_id and p.device_a_id=v_request.requester_device_id))) then
    raise exception 'Pairing revoked or incomplete';
  end if;
  if (select count(*) from public.transfers t where t.sender_device_id=p_target_device_id
      and t.status in ('pending','connecting','transferring','paused')) >= 100 then
    raise exception 'Too many pending transfers';
  end if;
  insert into public.transfers(sender_device_id,receiver_device_id,file_name,file_size,file_type,
    status,total_chunks,chunk_size,auto_accept,expires_at,request_id)
    values (p_target_device_id,v_request.requester_device_id,p_file_name,p_file_size,
      left(coalesce(p_file_type,'application/octet-stream'),128),'pending',
      ceil(p_file_size::numeric/65536)::integer,65536,false,now()+interval '7 days',p_request_id)
    returning id into v_id;
  update public.transfer_requests set status='fulfilled' where id=p_request_id;
  return v_id;
end $$;

-- If local browser storage cannot keep the file, undo the claimed response safely.
create or replace function public.rollback_file_response(
  p_target_device_id uuid,p_request_id uuid,p_transfer_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_rolled boolean;
begin
  if auth.uid() is null or not private.owns_device(p_target_device_id) then
    raise exception 'Unauthorized device';
  end if;
  update public.transfers set status='cancelled',updated_at=now()
    where id=p_transfer_id and request_id=p_request_id and sender_device_id=p_target_device_id
      and status='pending' returning true into v_rolled;
  if coalesce(v_rolled,false) then
    update public.transfer_requests set status='pending'
      where id=p_request_id and target_device_id=p_target_device_id and status='fulfilled';
  end if;
  return coalesce(v_rolled,false);
end $$;

revoke all on function public.create_file_request(uuid,uuid,text) from public,anon;
revoke all on function public.decline_file_request(uuid,uuid) from public,anon;
revoke all on function public.fulfill_file_request(uuid,uuid,text,bigint,text) from public,anon;
revoke all on function public.rollback_file_response(uuid,uuid,uuid) from public,anon;
grant execute on function public.create_file_request(uuid,uuid,text) to authenticated;
grant execute on function public.decline_file_request(uuid,uuid) to authenticated;
grant execute on function public.fulfill_file_request(uuid,uuid,text,bigint,text) to authenticated;
grant execute on function public.rollback_file_response(uuid,uuid,uuid) to authenticated;
