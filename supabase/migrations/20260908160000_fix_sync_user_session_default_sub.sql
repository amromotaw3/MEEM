-- Migration: Fix default subscription_expires_at in sync_user_session
-- Newly registered / synced users default to Free Tier (subscription_expires_at IS NULL).
-- Only super admins get 100 years.

CREATE OR REPLACE FUNCTION public.sync_user_session(p_user_id uuid, p_email text, p_username text, p_hardware_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $
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

  v_is_superadmin := clean_email IN ('amro.motawa@icloud.com', 'amromotaw3@gmail.com');

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
      case when v_is_superadmin then now() + interval '100 years' else null end
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
end;
$;

GRANT EXECUTE ON FUNCTION public.sync_user_session(uuid, text, text, text) TO anon, authenticated;
