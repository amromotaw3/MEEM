-- BASELINE (auto-generated snapshot of all public functions from the live MDV DB).
-- Purpose: guarantee a fresh `supabase db reset`/deploy converges to the exact
-- function definitions currently running in production, eliminating drift caused by
-- earlier dashboard-only edits. Runs last; all CREATE OR REPLACE (idempotent, grants
-- preserved). Tables/policies are created by the preceding migrations.

CREATE OR REPLACE FUNCTION public.admin_mutation(admin_id uuid, action text, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin boolean;
  v_hardware_id text;
  v_reason text;
  v_target_user uuid;
  v_max_devices int;
  v_days int;
  v_updated public.users_accounts%rowtype;
begin
  select exists(
    select 1 from public.users_accounts ua
    where ua.id = admin_id
      and (ua.role = 'admin' or lower(trim(ua.email)) = 'amro.motawa@icloud.com')
  ) into v_is_admin;

  if not v_is_admin then
    return jsonb_build_object('success', false, 'error', 'Unauthorized');
  end if;

  if action = 'ban-hardware' then
    v_hardware_id := trim(payload->>'hardware_id');
    v_reason := coalesce(nullif(trim(payload->>'reason'), ''), 'No reason provided');
    if v_hardware_id is null or v_hardware_id = '' then
      return jsonb_build_object('success', false, 'error', 'hardware_id is required');
    end if;

    insert into public.hardware_blacklist(hardware_id, reason, is_banned, banned_at)
    values (v_hardware_id, v_reason, true, now())
    on conflict (hardware_id) do update
    set reason = excluded.reason, is_banned = true, banned_at = now();

    delete from public.user_devices ud where ud.hardware_id = v_hardware_id;
    return jsonb_build_object('success', true);
  elsif action = 'unban-hardware' then
    v_hardware_id := trim(payload->>'hardware_id');
    delete from public.hardware_blacklist hb where hb.hardware_id = v_hardware_id;
    return jsonb_build_object('success', true);
  elsif action = 'update-device-limit' then
    v_target_user := (payload->>'target_user_id')::uuid;
    v_max_devices := (payload->>'max_devices')::int;
    update public.users_accounts ua
    set max_devices = greatest(v_max_devices, 1)
    where ua.id = v_target_user
    returning * into v_updated;
    return jsonb_build_object('success', true, 'user', (to_jsonb(v_updated) - 'password_hash'));
  elsif action = 'extend-subscription' then
    v_target_user := (payload->>'target_user_id')::uuid;
    v_days := (payload->>'days')::int;
    update public.users_accounts ua
    set subscription_expires_at = greatest(coalesce(ua.subscription_expires_at, now()), now()) + (greatest(v_days, 1) || ' days')::interval
    where ua.id = v_target_user
    returning * into v_updated;
    return jsonb_build_object('success', true, 'user', (to_jsonb(v_updated) - 'password_hash'));
  else
    return jsonb_build_object('success', false, 'error', 'Unknown admin action');
  end if;
exception
  when others then
    return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_hardware_ban(hardware_id text)
 RETURNS TABLE(reason text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select hb.reason
  from public.hardware_blacklist hb
  where hb.hardware_id = trim(check_hardware_ban.hardware_id)
    and coalesce(hb.is_banned, true) = true
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.create_movie_request(user_id uuid, title text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request public.movie_requests%rowtype;
begin
  insert into public.movie_requests(user_id, title, status)
  values (user_id, trim(title), 'pending')
  returning * into v_request;

  return jsonb_build_object('success', true, 'request', to_jsonb(v_request));
exception
  when others then
    return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_profile(user_id uuid, name text, avatar text, max_age_rating integer, profile_pin text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO account_profiles(user_id,name,avatar,max_age_rating,profile_pin) VALUES (user_id,name,avatar,max_age_rating,profile_pin);
  RETURN json_build_object('success', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_profile(profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from public.account_profiles ap where ap.id = profile_id;
  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_user_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid;
BEGIN
    -- Get the ID of the currently authenticated user
    v_user_id := auth.uid();

    -- Ensure the user is authenticated
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 1. Delete associated data from your public tables
    -- (Add or remove tables depending on what user data you store)
    DELETE FROM public.account_profiles WHERE user_id = v_user_id;
    
    -- If you have other tables like continue_watching, watchlist, etc.
    -- DELETE FROM public.continue_watching WHERE user_id = v_user_id;
    -- DELETE FROM public.watchlist WHERE user_id = v_user_id;

    -- 2. Delete the user from the Supabase auth schema
    -- This will completely remove their account and revoke sessions.
    DELETE FROM auth.users WHERE id = v_user_id;
END;
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.fetch_media_for_profile(profile_id uuid)
 RETURNS SETOF media_content
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT m.* FROM media_content m
  JOIN account_profiles p ON p.id = profile_id
  WHERE m.age_rating <= p.max_age_rating
  UNION ALL
  SELECT m.* FROM media_content m WHERE EXISTS (
    SELECT 1 FROM account_profiles ap JOIN users_accounts ua ON ap.user_id = ua.id
    WHERE ap.id = profile_id AND ua.role = 'admin'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.fetch_movie_requests(user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin boolean;
begin
  select exists(
    select 1 from public.users_accounts ua
    where ua.id = fetch_movie_requests.user_id
      and (ua.role = 'admin' or lower(trim(ua.email)) = 'amro.motawa@icloud.com')
  ) into v_is_admin;

  return (
    select coalesce(jsonb_agg(to_jsonb(mr) order by mr.created_at desc), '[]'::jsonb)
    from public.movie_requests mr
    where v_is_admin or mr.user_id = fetch_movie_requests.user_id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_all_continue_watching(p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.updated_at desc), '[]'::jsonb)
  from public.continue_watching c
  where c.profile_id = p_profile_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_continue_watching(profile_id uuid, media_id text)
 RETURNS TABLE(last_position_seconds integer, updated_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select cw.last_position_seconds, cw.updated_at
  from public.continue_watching cw
  where cw.profile_id = get_continue_watching.profile_id
    and cw.media_id = get_continue_watching.media_id
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_pending_invitations(caller_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(membership_id uuid, list_id uuid, list_name text, invited_by_profile_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF caller_id IS NULL AND auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id AS membership_id,
    m.list_id,
    c.list_name,
    COALESCE(p.name, 'Unknown') AS invited_by_profile_name
  FROM public.list_members m
  JOIN public.custom_lists c ON m.list_id = c.id
  LEFT JOIN public.account_profiles p ON c.profile_id = p.id
  WHERE m.user_id = COALESCE(caller_id, auth.uid()) AND m.status = 'pending';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_profile_data_by_hardware(p_hardware_id text, p_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_watchlist jsonb;
  v_playback jsonb;
  v_locked jsonb;
  v_lists jsonb;
BEGIN
  -- Verify hardware_id maps to a valid, non-banned device and user
  SELECT ud.user_id INTO v_user_id
  FROM public.user_devices ud
  JOIN public.users_accounts ua ON ua.id = ud.user_id
  WHERE ud.hardware_id = trim(p_hardware_id)
    AND ua.is_banned = false
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Device not authorized');
  END IF;

  -- Verify the profile belongs to this user
  IF NOT EXISTS (
    SELECT 1 FROM public.account_profiles ap
    WHERE ap.id = p_profile_id AND ap.user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('error', 'Profile not found for this device');
  END IF;

  -- Fetch watchlist_items
  SELECT COALESCE(jsonb_agg(to_jsonb(w)), '[]'::jsonb)
  INTO v_watchlist
  FROM public.watchlist_items w
  WHERE w.profile_id = p_profile_id;

  -- Fetch playback_history
  SELECT COALESCE(jsonb_agg(to_jsonb(ph)), '[]'::jsonb)
  INTO v_playback
  FROM public.playback_history ph
  WHERE ph.profile_id = p_profile_id;

  -- Fetch locked_items
  SELECT COALESCE(jsonb_agg(to_jsonb(li)), '[]'::jsonb)
  INTO v_locked
  FROM public.locked_items li
  WHERE li.profile_id = p_profile_id;

  -- Fetch custom_lists (both owned and shared/joined) with list_items
  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(cl) || jsonb_build_object(
        'list_items', (
          SELECT COALESCE(jsonb_agg(to_jsonb(litem)), '[]'::jsonb)
          FROM public.list_items litem
          WHERE litem.list_id = cl.id
        )
      )
    ),
    '[]'::jsonb
  )
  INTO v_lists
  FROM public.custom_lists cl
  WHERE cl.profile_id = p_profile_id
     OR cl.id IN (
       SELECT lm.list_id 
       FROM public.list_members lm 
       WHERE lm.user_id = v_user_id AND lm.status = 'joined'
     );

  RETURN jsonb_build_object(
    'watchlist_items', v_watchlist,
    'playback_history', v_playback,
    'locked_items', v_locked,
    'custom_lists', v_lists
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_id_by_email(email_addr text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  target_uid uuid;
BEGIN
  SELECT id INTO target_uid
  FROM public.users_accounts
  WHERE LOWER(email) = LOWER(TRIM(email_addr))
  LIMIT 1;

  IF target_uid IS NULL THEN
    SELECT id INTO target_uid
    FROM auth.users
    WHERE LOWER(email) = LOWER(TRIM(email_addr))
    LIMIT 1;
  END IF;

  RETURN target_uid;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_id_by_username(username_val text)
 RETURNS TABLE(user_id uuid, allow_invitations boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.user_id, COALESCE(u.allow_invitations, true) AS allow_invitations
  FROM public.account_profiles p
  LEFT JOIN public.users_accounts u ON u.id = p.user_id
  WHERE LOWER(TRIM(p.name)) = LOWER(TRIM(username_val))
  LIMIT 1;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_logout(p_hardware_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.user_devices WHERE hardware_id = trim(p_hardware_id);
  RETURN jsonb_build_object('success', true, 'message', 'Device logged out successfully');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('error', 'Failed to log out device', 'details', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_register(email text, password text, hardware_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  clean_email text;
  new_user public.users_accounts%ROWTYPE;
  is_super boolean;
BEGIN
  clean_email := lower(trim(email));
  IF clean_email IS NULL OR position('@' in clean_email) = 0 THEN
    RETURN jsonb_build_object('error', 'Invalid email address');
  END IF;
  IF password IS NULL OR length(password) < 6 THEN
    RETURN jsonb_build_object('error', 'Password must be at least 6 characters long');
  END IF;

  IF EXISTS (SELECT 1 FROM public.users_accounts u WHERE u.email = clean_email) THEN
    RETURN jsonb_build_object('error', 'An account with this email already exists');
  END IF;

  is_super := clean_email = 'amro.motawa@icloud.com';

  INSERT INTO public.users_accounts (email, password_hash, role, max_devices, is_banned, subscription_expires_at)
  VALUES (
    clean_email,
    extensions.crypt(password, extensions.gen_salt('bf')),
    CASE WHEN is_super THEN 'admin' ELSE 'user' END,
    CASE WHEN is_super THEN 9999 ELSE 2 END,
    false,
    now() + interval '30 days'
  )
  RETURNING * INTO new_user;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Account created successfully',
    'user', jsonb_build_object(
      'id', new_user.id,
      'email', new_user.email,
      'role', new_user.role,
      'max_devices', new_user.max_devices
    )
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('error', 'Failed to create user account', 'details', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_secure_login(email text, password text, hardware_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  clean_email text;
  clean_hw text;
  u public.users_accounts%ROWTYPE;
  device_count int;
  max_dev int;
  prof jsonb;
BEGIN
  clean_email := lower(trim(email));
  clean_hw := trim(hardware_id);

  IF clean_email IS NULL OR clean_email = '' OR password IS NULL OR password = '' THEN
    RETURN jsonb_build_object('error', 'Email and password are required');
  END IF;
  IF clean_hw IS NULL OR clean_hw = '' THEN
    RETURN jsonb_build_object('error', 'Device Hardware ID is required for authentication');
  END IF;

  IF EXISTS (SELECT 1 FROM public.hardware_blacklist b WHERE b.hardware_id = clean_hw) THEN
    RETURN jsonb_build_object(
      'error', 'HARDWARE_BANNED',
      'message', 'This device has been globally banned.'
    );
  END IF;

  SELECT * INTO u FROM public.users_accounts WHERE public.users_accounts.email = clean_email LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invalid email or password');
  END IF;

  IF u.is_banned THEN
    RETURN jsonb_build_object('error', 'ACCOUNT_BANNED', 'message', 'Your account has been suspended.');
  END IF;

  IF u.password_hash IS NULL OR u.password_hash <> extensions.crypt(password, u.password_hash) THEN
    RETURN jsonb_build_object('error', 'Invalid email or password');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_devices d WHERE d.user_id = u.id AND d.hardware_id = clean_hw) THEN
    SELECT count(*)::int INTO device_count FROM public.user_devices d WHERE d.user_id = u.id;
    max_dev := coalesce(u.max_devices, 2);
    IF device_count >= max_dev THEN
      RETURN jsonb_build_object(
        'error', 'DEVICE_LIMIT_REACHED',
        'message', format('Device authorization failed. Maximum %s active devices.', max_dev)
      );
    END IF;
    INSERT INTO public.user_devices (user_id, hardware_id) VALUES (u.id, clean_hw);
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.created_at), '[]'::jsonb)
  INTO prof
  FROM public.account_profiles p
  WHERE p.user_id = u.id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Authenticated successfully',
    'user', (to_jsonb(u) - 'password_hash') || jsonb_build_object(
      'role', CASE WHEN clean_email = 'amro.motawa@icloud.com' THEN 'admin' ELSE coalesce(u.role, 'user') END
    ),
    'profiles', prof,
    'hardware_id', clean_hw
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('error', 'Internal Server Error', 'details', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;
  
  IF auth.email() = ANY (ARRAY['gamer.motawa@gmail.com'::text, 'amro.motawa@icloud.com'::text]) THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1 
    FROM public.users_accounts 
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_list_member(p_list_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.list_members
    WHERE list_id = p_list_id AND user_id = p_user_id AND status = 'joined'
  ) OR EXISTS (
    SELECT 1 FROM public.users_accounts
    WHERE id = p_user_id AND role = 'admin'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_list_owner(p_list_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.custom_lists c
    JOIN public.account_profiles p ON c.profile_id = p.id
    WHERE c.id = p_list_id AND p.user_id = p_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.users_accounts
    WHERE id = p_user_id AND role = 'admin'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_list_participant(list_uuid uuid, user_uuid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.custom_lists 
        WHERE id = list_uuid AND profile_id IN (SELECT id FROM public.account_profiles WHERE user_id = user_uuid)
    ) OR EXISTS (
        SELECT 1 FROM public.list_members 
        WHERE list_id = list_uuid AND user_id = user_uuid AND status = 'joined'
    ) OR EXISTS (
        SELECT 1 FROM public.users_accounts
        WHERE id = user_uuid AND role = 'admin'
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_collaborators(query_str text, caller_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(user_id uuid, email text, profile_name text, allow_invitations boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := COALESCE(caller_id, auth.uid());
BEGIN
  IF v_caller IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    p.user_id,
    COALESCE(u.email, au.email, '')::text AS email,
    p.name::text AS profile_name,
    COALESCE(u.allow_invitations, true) AS allow_invitations
  FROM public.account_profiles p
  LEFT JOIN public.users_accounts u ON u.id = p.user_id
  LEFT JOIN auth.users au ON au.id = p.user_id
  WHERE
    (p.name ILIKE '%' || query_str || '%'
       OR u.email ILIKE '%' || query_str || '%'
       OR au.email ILIKE '%' || query_str || '%')
    AND p.user_id <> v_caller
  LIMIT 10;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.share_custom_list(profile_id_a uuid, profile_id_b uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    user_id_a UUID;
    user_id_b UUID;
BEGIN
    SELECT user_id INTO user_id_a FROM public.account_profiles WHERE id = profile_id_a;
    SELECT user_id INTO user_id_b FROM public.account_profiles WHERE id = profile_id_b;
    
    IF user_id_a IS NULL OR user_id_b IS NULL THEN
        RETURN FALSE;
    END IF;

    IF user_id_a = user_id_b THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1 
        FROM public.custom_lists cl
        WHERE 
            (cl.profile_id = profile_id_a AND cl.id IN (SELECT list_id FROM public.list_members WHERE user_id = user_id_b AND status = 'joined'))
            OR
            (cl.profile_id = profile_id_b AND cl.id IN (SELECT list_id FROM public.list_members WHERE user_id = user_id_a AND status = 'joined'))
            OR
            (cl.id IN (SELECT list_id FROM public.list_members WHERE user_id = user_id_a AND status = 'joined')
             AND cl.id IN (SELECT list_id FROM public.list_members WHERE user_id = user_id_b AND status = 'joined'))
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_user_session(p_user_id uuid, p_email text, p_username text, p_hardware_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  clean_email text;
  clean_hw text;
  v_account public.users_accounts%rowtype;
  v_device_exists boolean;
  v_active_devices int;
  v_max_devices int;
  v_profiles jsonb;
  v_default_profile public.account_profiles%rowtype;
  v_is_superadmin boolean;
begin
  clean_email := lower(trim(p_email));
  clean_hw := nullif(trim(coalesce(p_hardware_id, '')), '');

  if p_user_id is null or clean_email is null or clean_email = '' then
    return jsonb_build_object('error', 'User ID and Email are required');
  end if;

  if clean_hw is not null and exists (
    select 1 from public.hardware_blacklist hb
    where hb.hardware_id = clean_hw and coalesce(hb.is_banned, true) = true
  ) then
    return jsonb_build_object('error', 'HARDWARE_BANNED', 'message', 'This device has been globally banned.');
  end if;

  v_is_superadmin := clean_email = 'amro.motawa@icloud.com';

  select * into v_account from public.users_accounts ua where ua.id = p_user_id;

  if not found then
    insert into public.users_accounts (id, email, password_hash, role, max_devices, is_banned, subscription_expires_at)
    values (
      p_user_id,
      clean_email,
      extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
      case when v_is_superadmin then 'admin' else 'user' end,
      case when v_is_superadmin then 9999 else 3 end,
      false,
      now() + interval '30 days'
    )
    on conflict (email) do update
      set role = case when v_is_superadmin then 'admin' else public.users_accounts.role end
    returning * into v_account;
  else
    update public.users_accounts
    set email = clean_email,
        role = case when v_is_superadmin then 'admin' else role end
    where id = v_account.id
    returning * into v_account;
  end if;

  if v_account.is_banned then
    return jsonb_build_object('error', 'ACCOUNT_BANNED', 'message', 'Your account has been suspended.');
  end if;

  if clean_hw is not null then
    select exists(select 1 from public.user_devices d where d.user_id = v_account.id and d.hardware_id = clean_hw) into v_device_exists;
    if not v_device_exists then
      select count(*) into v_active_devices from public.user_devices d where d.user_id = v_account.id;
      v_max_devices := coalesce(v_account.max_devices, 3);
      if v_active_devices >= v_max_devices then
        return jsonb_build_object('error', 'DEVICE_LIMIT_REACHED', 'message', 'Device authorization failed. You have reached your maximum limit of ' || v_max_devices || ' active devices.');
      end if;
      insert into public.user_devices (user_id, hardware_id) values (v_account.id, clean_hw);
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at), '[]'::jsonb)
  into v_profiles
  from public.account_profiles p
  where p.user_id = v_account.id;

  if jsonb_array_length(v_profiles) = 0 then
    insert into public.account_profiles (user_id, name, avatar, max_age_rating)
    values (v_account.id, coalesce(nullif(p_username, ''), split_part(clean_email, '@', 1)), '', 18)
    returning * into v_default_profile;
    v_profiles := jsonb_build_array(to_jsonb(v_default_profile));
  end if;

  return jsonb_build_object(
    'success', true,
    'user', (to_jsonb(v_account) - 'password_hash') || jsonb_build_object('role', case when v_is_superadmin then 'admin' else coalesce(v_account.role, 'user') end),
    'profiles', v_profiles,
    'hardware_id', clean_hw
  );
exception
  when others then
    return jsonb_build_object('error', 'SYNC_FAILED', 'details', sqlerrm);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_profile(id uuid, name text DEFAULT NULL::text, avatar text DEFAULT NULL::text, profile_pin text DEFAULT NULL::text, max_age_rating integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profile public.account_profiles%rowtype;
begin
  update public.account_profiles ap
  set name = coalesce(nullif(update_profile.name, ''), ap.name),
      avatar = coalesce(update_profile.avatar, ap.avatar),
      profile_pin = case when update_profile.profile_pin is null then ap.profile_pin else nullif(update_profile.profile_pin, '') end,
      max_age_rating = coalesce(update_profile.max_age_rating, ap.max_age_rating)
  where ap.id = update_profile.id
  returning * into v_profile;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Profile not found');
  end if;

  return jsonb_build_object('success', true, 'profile', to_jsonb(v_profile));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_user_settings(p_user_id uuid, p_hardware_id text, p_tmdb_api_key text DEFAULT NULL::text, p_subdl_api_key text DEFAULT NULL::text, p_fanart_api_key text DEFAULT NULL::text, p_subdl_enabled boolean DEFAULT NULL::boolean, p_subdl_languages text DEFAULT NULL::text, p_subdl_hearing_impairment text DEFAULT NULL::text, p_trakt_access_token text DEFAULT NULL::text, p_trakt_refresh_token text DEFAULT NULL::text, p_trakt_created_at bigint DEFAULT NULL::bigint, p_trakt_expires_in integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_device_valid boolean := false;
BEGIN
  -- Validate that this hardware_id belongs to the given user_id
  SELECT EXISTS(
    SELECT 1 FROM public.user_devices
    WHERE user_id = p_user_id AND hardware_id = p_hardware_id
  ) INTO v_device_valid;

  -- Also allow if user is authenticated via Supabase JWT
  IF NOT v_device_valid THEN
    v_device_valid := (auth.uid() = p_user_id);
  END IF;

  IF NOT v_device_valid THEN
    RETURN jsonb_build_object('success', false, 'error', 'Device not authorized for this user');
  END IF;

  UPDATE public.users_accounts SET
    tmdb_api_key            = CASE WHEN p_tmdb_api_key IS NOT NULL THEN p_tmdb_api_key ELSE tmdb_api_key END,
    subdl_api_key           = CASE WHEN p_subdl_api_key IS NOT NULL THEN p_subdl_api_key ELSE subdl_api_key END,
    fanart_api_key          = CASE WHEN p_fanart_api_key IS NOT NULL THEN p_fanart_api_key ELSE fanart_api_key END,
    subdl_enabled           = CASE WHEN p_subdl_enabled IS NOT NULL THEN p_subdl_enabled ELSE subdl_enabled END,
    subdl_languages         = CASE WHEN p_subdl_languages IS NOT NULL THEN p_subdl_languages ELSE subdl_languages END,
    subdl_hearing_impairment = CASE WHEN p_subdl_hearing_impairment IS NOT NULL THEN p_subdl_hearing_impairment ELSE subdl_hearing_impairment END,
    trakt_access_token      = CASE WHEN p_trakt_access_token IS NOT NULL THEN p_trakt_access_token ELSE trakt_access_token END,
    trakt_refresh_token     = CASE WHEN p_trakt_refresh_token IS NOT NULL THEN p_trakt_refresh_token ELSE trakt_refresh_token END,
    trakt_created_at        = CASE WHEN p_trakt_created_at IS NOT NULL THEN p_trakt_created_at ELSE trakt_created_at END,
    trakt_expires_in        = CASE WHEN p_trakt_expires_in IS NOT NULL THEN p_trakt_expires_in ELSE trakt_expires_in END
  WHERE id = p_user_id;

  RETURN jsonb_build_object('success', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_continue_watching(profile_id uuid, media_id text, last_position_seconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.continue_watching (profile_id, media_id, last_position_seconds, updated_at)
  values (profile_id, media_id, greatest(coalesce(last_position_seconds, 0), 0), now())
  on conflict (profile_id, media_id)
  do update set last_position_seconds = excluded.last_position_seconds, updated_at = now();

  return jsonb_build_object('success', true);
exception
  when others then
    return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_playback_by_hardware(p_hardware_id text, p_profile_id uuid, p_media_id text, p_progress numeric, p_duration numeric, p_watched boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT ud.user_id INTO v_user_id
  FROM public.user_devices ud
  JOIN public.users_accounts ua ON ua.id = ud.user_id
  WHERE ud.hardware_id = trim(p_hardware_id)
    AND ua.is_banned = false
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Device not authorized');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.account_profiles ap
    WHERE ap.id = p_profile_id AND ap.user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('error', 'Profile not found for this device');
  END IF;

  INSERT INTO public.playback_history (profile_id, media_id, progress, duration, last_watched_at, watched)
  VALUES (p_profile_id, p_media_id, p_progress, p_duration, now(), p_watched)
  ON CONFLICT (profile_id, media_id)
  DO UPDATE SET
    progress = EXCLUDED.progress,
    duration = EXCLUDED.duration,
    last_watched_at = now(),
    watched = EXCLUDED.watched;

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_profile(p_id uuid, p_user_id uuid, p_name text, p_avatar text, p_max_age_rating integer, p_profile_pin text, p_watchlist jsonb, p_pinned jsonb, p_banner text, p_playback jsonb, p_locked_items jsonb, p_custom_lists jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    INSERT INTO public.account_profiles (
      id, user_id, name, avatar, max_age_rating, profile_pin,
      watchlist, pinned, banner, playback, locked_items, custom_lists
    )
    VALUES (
      p_id, p_user_id, p_name, p_avatar, p_max_age_rating, p_profile_pin,
      p_watchlist, p_pinned, p_banner, p_playback, p_locked_items, p_custom_lists
    )
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        avatar = EXCLUDED.avatar,
        max_age_rating = EXCLUDED.max_age_rating,
        profile_pin = EXCLUDED.profile_pin,
        watchlist = EXCLUDED.watchlist,
        pinned = EXCLUDED.pinned,
        banner = EXCLUDED.banner,
        playback = EXCLUDED.playback,
        locked_items = EXCLUDED.locked_items,
        custom_lists = EXCLUDED.custom_lists;

    RETURN jsonb_build_object('success', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.user_allows_invites(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(allow_invitations, true) 
  FROM public.users_accounts 
  WHERE id = p_user_id;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_profile_pin(profile_id uuid, pin text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'valid', exists (
      select 1 from public.account_profiles ap
      where ap.id = verify_profile_pin.profile_id
        and coalesce(ap.profile_pin, '') = coalesce(verify_profile_pin.pin, '')
    )
  );
$function$

