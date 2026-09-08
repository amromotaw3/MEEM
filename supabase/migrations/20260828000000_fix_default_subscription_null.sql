-- Migration: Fix default subscription_expires_at for regular users
-- Regular newly registered users default to Free Tier (subscription_expires_at IS NULL).
-- Only super admins get 100 years.

CREATE OR REPLACE FUNCTION public.handle_register(
  p_email text,
  p_password text,
  p_hw_id text DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_device_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  clean_email text;
  clean_hw text;
  clean_plat text;
  clean_dname text;
  is_super boolean;
  new_user public.users_accounts%ROWTYPE;
  existing_dev record;
BEGIN
  clean_email := lower(trim(coalesce(p_email, '')));
  clean_hw    := trim(coalesce(p_hw_id, ''));
  clean_plat  := trim(coalesce(p_platform, 'desktop'));
  clean_dname := trim(coalesce(p_device_name, 'Desktop App'));

  IF clean_email = '' OR clean_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RETURN jsonb_build_object('error', 'Please enter a valid email address');
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RETURN jsonb_build_object('error', 'Password must be at least 6 characters');
  END IF;

  IF clean_hw = '' THEN clean_hw := NULL; END IF;

  is_super := clean_email IN ('amro.motawa@icloud.com', 'amromotaw3@gmail.com');

  SELECT * INTO new_user FROM public.users_accounts WHERE public.users_accounts.email = clean_email;
  IF FOUND THEN
    IF new_user.password_hash IS NULL OR new_user.password_hash = 'SUPABASE_AUTH' THEN
      UPDATE public.users_accounts
      SET password_hash = extensions.crypt(p_password, extensions.gen_salt('bf'))
      WHERE id = new_user.id
      RETURNING * INTO new_user;
    ELSE
      RETURN jsonb_build_object('error', 'An account with this email already exists');
    END IF;
  ELSE
    INSERT INTO public.users_accounts (email, password_hash, role, max_devices, is_banned, subscription_expires_at)
    VALUES (
      clean_email,
      extensions.crypt(p_password, extensions.gen_salt('bf')),
      CASE WHEN is_super THEN 'admin' ELSE 'user' END,
      CASE WHEN is_super THEN 9999 ELSE 3 END,
      false,
      CASE WHEN is_super THEN now() + interval '100 years' ELSE NULL END
    )
    RETURNING * INTO new_user;
  END IF;

  IF clean_hw IS NOT NULL THEN
    SELECT * INTO existing_dev FROM public.user_devices WHERE hardware_id = clean_hw LIMIT 1;
    IF existing_dev.id IS NOT NULL THEN
      IF existing_dev.user_id != new_user.id THEN
        UPDATE public.user_devices
        SET user_id = new_user.id, platform = clean_plat, device_name = clean_dname, last_seen_at = now()
        WHERE id = existing_dev.id;
      ELSE
        UPDATE public.user_devices
        SET last_seen_at = now(), platform = clean_plat, device_name = clean_dname
        WHERE id = existing_dev.id;
      END IF;
    ELSE
      INSERT INTO public.user_devices (user_id, hardware_id, platform, device_name, last_seen_at)
      VALUES (new_user.id, clean_hw, clean_plat, clean_dname, now());
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'user', jsonb_build_object(
      'id', new_user.id,
      'email', new_user.email,
      'role', new_user.role,
      'is_banned', new_user.is_banned,
      'subscription_expires_at', new_user.subscription_expires_at
    )
  );
END;
$$;
