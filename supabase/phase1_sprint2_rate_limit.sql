-- Sprint 2 security fix: invalid invitation attempts MUST NOT roll back their
-- audit rows. Return NULL (a successful SQL transaction) for unknown/used/
-- expired codes and rate-limited requests. Client renders a generic error.
-- This is per-auth-identity throttling, NOT a substitute for IP/device abuse
-- controls before public release (anonymous accounts can be recreated).
create or replace function public.join_transfer_room(p_receiver_device_id uuid,p_code_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_room_id uuid;
begin
  if auth.uid() is null or not private.owns_device(p_receiver_device_id) then
    raise exception 'Not authorized for this device';
  end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  if (select count(*) from private.room_join_attempts
       where user_id=auth.uid() and created_at > now() - interval '10 minutes') >= 6 then
    return null;
  end if;
  -- Insert is committed even when the code is unknown; no exception afterward.
  insert into private.room_join_attempts(user_id) values(auth.uid());
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  update public.transfer_rooms
  set receiver_device_id=p_receiver_device_id, receiver_user_id=auth.uid(), joined_at=now()
  where code_hash=p_code_hash and expires_at>now() and joined_at is null
    and sender_user_id<>auth.uid()
  returning id into v_room_id;
  return v_room_id;
end $$;
revoke all on function public.join_transfer_room(uuid,text) from public,anon;
grant execute on function public.join_transfer_room(uuid,text) to authenticated;
