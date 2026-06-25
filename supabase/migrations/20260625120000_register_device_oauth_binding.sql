-- Bind a device to a user account for OAuth (Google / Discord) logins.
--
-- Root cause of the mobile "login succeeds then bounces back to login" loop:
-- device_session(hardware_id) only returns authenticated:true when the device
-- exists in public.user_devices. The email/password path (handle_secure_login)
-- inserts that row, but the OAuth path (cloudSyncUserSession) never did, so
-- device_session always returned authenticated:false for Google/Discord users
-- and the client wiped the (valid) Supabase session on every load.
--
-- This RPC mirrors the device-binding logic in handle_secure_login so the OAuth
-- flow can register the device. It is idempotent and enforces the per-account
-- device limit (max_devices, default 2), matching email/password behaviour.
CREATE OR REPLACE FUNCTION public.register_device(p_user_id uuid, p_hardware_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  clean_hw     text;
  v_user       public.users_accounts%rowtype;
  device_count int;
  max_dev      int;
begin
  clean_hw := trim(p_hardware_id);

  if p_user_id is null then
    return jsonb_build_object('error', 'User ID is required');
  end if;
  if clean_hw is null or clean_hw = '' then
    return jsonb_build_object('error', 'Device Hardware ID is required');
  end if;

  -- Global hardware ban
  if exists (
    select 1 from public.hardware_blacklist b where b.hardware_id = clean_hw
  ) then
    return jsonb_build_object(
      'error', 'HARDWARE_BANNED',
      'message', 'This device has been globally banned.'
    );
  end if;

  select * into v_user
  from public.users_accounts ua
  where ua.id = p_user_id
  limit 1;

  if not found then
    return jsonb_build_object('error', 'Account not found');
  end if;
  if v_user.is_banned then
    return jsonb_build_object('error', 'ACCOUNT_BANNED', 'message', 'Your account has been suspended.');
  end if;

  -- Idempotent: already bound → success
  if exists (
    select 1 from public.user_devices d
    where d.user_id = p_user_id and d.hardware_id = clean_hw
  ) then
    return jsonb_build_object('success', true, 'message', 'Device already registered', 'hardware_id', clean_hw);
  end if;

  -- Enforce per-account device limit (same rule as handle_secure_login)
  select count(*)::int into device_count
  from public.user_devices d
  where d.user_id = p_user_id;

  max_dev := coalesce(v_user.max_devices, 2);
  if device_count >= max_dev then
    return jsonb_build_object(
      'error', 'DEVICE_LIMIT_REACHED',
      'message', format('Device authorization failed. Maximum %s active devices.', max_dev)
    );
  end if;

  insert into public.user_devices (user_id, hardware_id) values (p_user_id, clean_hw);
  return jsonb_build_object('success', true, 'message', 'Device registered', 'hardware_id', clean_hw);
exception
  when others then
    return jsonb_build_object('error', 'Internal Server Error', 'details', SQLERRM);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.register_device(uuid, text) TO anon, authenticated;
