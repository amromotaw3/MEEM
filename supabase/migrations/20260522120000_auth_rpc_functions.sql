-- Auth RPC functions (SECURITY DEFINER) so Electron/web can login/register without service_role in the client.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DROP FUNCTION IF EXISTS public.handle_register(text, text, text);
DROP FUNCTION IF EXISTS public.handle_secure_login(text, text, text);

CREATE OR REPLACE FUNCTION public.handle_register(
  email text,
  password text,
  hardware_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.handle_secure_login(
  email text,
  password text,
  hardware_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.handle_register(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_secure_login(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_register(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_secure_login(text, text, text) TO anon, authenticated, service_role;
