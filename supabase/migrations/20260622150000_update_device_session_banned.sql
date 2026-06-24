-- Update device_session RPC function to return user details even when banned
-- This allows the client to immediately detect that the account is banned.
CREATE OR REPLACE FUNCTION public.device_session(hardware_id text)
 RETURNS TABLE(authenticated boolean, "user" json, profiles json)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  clean_hw text;
  v_user_id uuid;
  v_user_json json;
  v_profiles_json json;
  v_is_banned boolean;
begin
  clean_hw := trim(hardware_id);

  if clean_hw is null or clean_hw = '' then
    return query select false, null::json, null::json;
    return;
  end if;

  if exists (
    select 1 from public.hardware_blacklist hb
    where hb.hardware_id = clean_hw and coalesce(hb.is_banned, true) = true
  ) then
    return query select false, null::json, null::json;
    return;
  end if;

  select ud.user_id into v_user_id
  from public.user_devices ud
  where ud.hardware_id = clean_hw
  order by ud.created_at desc
  limit 1;

  if v_user_id is null then
    return query select false, null::json, null::json;
    return;
  end if;

  select (to_jsonb(ua) - 'password_hash')::json, ua.is_banned into v_user_json, v_is_banned
  from public.users_accounts ua
  where ua.id = v_user_id;

  if v_is_banned then
    return query select false, v_user_json, null::json;
    return;
  end if;

  select coalesce(jsonb_agg(to_jsonb(ap) order by ap.created_at), '[]'::jsonb)::json into v_profiles_json
  from public.account_profiles ap
  where ap.user_id = v_user_id;

  return query select true, v_user_json, v_profiles_json;
end;
$function$;
