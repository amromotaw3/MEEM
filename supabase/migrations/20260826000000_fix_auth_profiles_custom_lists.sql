-- Migration: 20260826000000_fix_auth_profiles_custom_lists.sql
-- Fixes user registration, profile creation RPCs, and RLS policies for custom authentication

-- 1. Update handle_register to automatically create default profile and bind device hardware ID
CREATE OR REPLACE FUNCTION public.handle_register(
  email text,
  password text,
  hardware_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  clean_email text;
  clean_hw text;
  new_user public.users_accounts%ROWTYPE;
  is_super boolean;
  default_prof public.account_profiles%ROWTYPE;
BEGIN
  clean_email := lower(trim(email));
  clean_hw := nullif(trim(coalesce(hardware_id, '')), '');

  IF clean_email IS NULL OR position('@' in clean_email) = 0 THEN
    RETURN jsonb_build_object('error', 'Invalid email address');
  END IF;
  IF password IS NULL OR length(password) < 6 THEN
    RETURN jsonb_build_object('error', 'Password must be at least 6 characters long');
  END IF;

  IF clean_hw IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.hardware_blacklist b WHERE b.hardware_id = clean_hw AND coalesce(b.is_banned, true) = true
  ) THEN
    RETURN jsonb_build_object('error', 'HARDWARE_BANNED', 'message', 'This device has been globally banned.');
  END IF;

  is_super := clean_email = 'amro.motawa@icloud.com';

  SELECT * INTO new_user FROM public.users_accounts WHERE public.users_accounts.email = clean_email;
  IF FOUND THEN
    -- If account exists and password_hash is not set or temporary, update password & activate
    IF new_user.password_hash IS NULL OR new_user.password_hash = 'SUPABASE_AUTH' THEN
      UPDATE public.users_accounts
      SET password_hash = extensions.crypt(password, extensions.gen_salt('bf'))
      WHERE id = new_user.id
      RETURNING * INTO new_user;
    ELSE
      RETURN jsonb_build_object('error', 'An account with this email already exists');
    END IF;
  ELSE
    INSERT INTO public.users_accounts (email, password_hash, role, max_devices, is_banned, subscription_expires_at)
    VALUES (
      clean_email,
      extensions.crypt(password, extensions.gen_salt('bf')),
      CASE WHEN is_super THEN 'admin' ELSE 'user' END,
      CASE WHEN is_super THEN 9999 ELSE 3 END,
      CASE WHEN is_super THEN now() + interval '100 years' ELSE NULL END
    )
    RETURNING * INTO new_user;
  END IF;

  -- Bind device hardware ID if provided
  IF clean_hw IS NOT NULL THEN
    INSERT INTO public.user_devices (user_id, hardware_id)
    VALUES (new_user.id, clean_hw)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Ensure default profile
  IF NOT EXISTS (SELECT 1 FROM public.account_profiles p WHERE p.user_id = new_user.id) THEN
    INSERT INTO public.account_profiles (user_id, name, avatar, max_age_rating)
    VALUES (new_user.id, split_part(clean_email, '@', 1), 'imgs/avatar.png', 18)
    RETURNING * INTO default_prof;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user', (to_jsonb(new_user) - 'password_hash') || jsonb_build_object('role', CASE WHEN is_super THEN 'admin' ELSE coalesce(new_user.role, 'user') END)
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('error', 'Failed to create user account', 'details', SQLERRM);
END;
$$;

-- 2. Update create_profile with default parameters and SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.create_profile(
  user_id uuid,
  name text,
  avatar text DEFAULT NULL::text,
  max_age_rating integer DEFAULT 18,
  profile_pin text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile public.account_profiles%ROWTYPE;
BEGIN
  IF user_id IS NULL OR name IS NULL OR trim(name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_id and name are required');
  END IF;

  INSERT INTO public.account_profiles (user_id, name, avatar, max_age_rating, profile_pin)
  VALUES (user_id, trim(name), avatar, COALESCE(max_age_rating, 18), profile_pin)
  RETURNING * INTO v_profile;

  RETURN jsonb_build_object('success', true, 'profile', to_jsonb(v_profile));
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 3. Update upsert_profile to fix invalid column references
CREATE OR REPLACE FUNCTION public.upsert_profile(
  p_id uuid,
  p_user_id uuid,
  p_name text,
  p_avatar text DEFAULT NULL::text,
  p_max_age_rating integer DEFAULT 18,
  p_profile_pin text DEFAULT NULL::text,
  p_watchlist jsonb DEFAULT NULL::jsonb,
  p_pinned jsonb DEFAULT NULL::jsonb,
  p_banner text DEFAULT NULL::text,
  p_playback jsonb DEFAULT NULL::jsonb,
  p_locked_items jsonb DEFAULT NULL::jsonb,
  p_custom_lists jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile public.account_profiles%ROWTYPE;
BEGIN
  INSERT INTO public.account_profiles (
    id, user_id, name, avatar, max_age_rating, profile_pin, banner
  )
  VALUES (
    p_id, p_user_id, trim(p_name), p_avatar, COALESCE(p_max_age_rating, 18), p_profile_pin, p_banner
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    avatar = EXCLUDED.avatar,
    max_age_rating = EXCLUDED.max_age_rating,
    profile_pin = EXCLUDED.profile_pin,
    banner = EXCLUDED.banner
  RETURNING * INTO v_profile;

  RETURN jsonb_build_object('success', true, 'profile', to_jsonb(v_profile));
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 4. Enable Permissive RLS Policies for Custom Auth compatibility (anon key queries)

-- account_profiles
DROP POLICY IF EXISTS "Users can select all profiles" ON public.account_profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.account_profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.account_profiles;
DROP POLICY IF EXISTS "Users can delete their own profile" ON public.account_profiles;
DROP POLICY IF EXISTS "Allow public all access on account_profiles" ON public.account_profiles;

CREATE POLICY "Allow public all access on account_profiles"
  ON public.account_profiles FOR ALL TO public USING (true) WITH CHECK (true);

-- custom_lists
DROP POLICY IF EXISTS "select_custom_lists_participant" ON public.custom_lists;
DROP POLICY IF EXISTS "Members can view custom lists" ON public.custom_lists;
DROP POLICY IF EXISTS "Owners can manage their own custom lists" ON public.custom_lists;
DROP POLICY IF EXISTS "Allow public all access on custom_lists" ON public.custom_lists;

CREATE POLICY "Allow public all access on custom_lists"
  ON public.custom_lists FOR ALL TO public USING (true) WITH CHECK (true);

-- list_items
DROP POLICY IF EXISTS "select_list_items_participant" ON public.list_items;
DROP POLICY IF EXISTS "Members can view list items" ON public.list_items;
DROP POLICY IF EXISTS "Members can insert list items" ON public.list_items;
DROP POLICY IF EXISTS "Members can delete list items" ON public.list_items;
DROP POLICY IF EXISTS "Owners can manage list items" ON public.list_items;
DROP POLICY IF EXISTS "Allow public all access on list_items" ON public.list_items;

CREATE POLICY "Allow public all access on list_items"
  ON public.list_items FOR ALL TO public USING (true) WITH CHECK (true);

-- watchlist_items
DROP POLICY IF EXISTS "Users can manage their own watchlist items" ON public.watchlist_items;
DROP POLICY IF EXISTS "select_watchlist_items_shared" ON public.watchlist_items;
DROP POLICY IF EXISTS "Allow public all access on watchlist_items" ON public.watchlist_items;

CREATE POLICY "Allow public all access on watchlist_items"
  ON public.watchlist_items FOR ALL TO public USING (true) WITH CHECK (true);

-- playback_history
DROP POLICY IF EXISTS "Users can manage their own playback history" ON public.playback_history;
DROP POLICY IF EXISTS "select_playback_history_shared" ON public.playback_history;
DROP POLICY IF EXISTS "Allow public all access on playback_history" ON public.playback_history;

CREATE POLICY "Allow public all access on playback_history"
  ON public.playback_history FOR ALL TO public USING (true) WITH CHECK (true);

-- locked_items
DROP POLICY IF EXISTS "Users can manage their own locked items" ON public.locked_items;
DROP POLICY IF EXISTS "Allow public all access on locked_items" ON public.locked_items;

CREATE POLICY "Allow public all access on locked_items"
  ON public.locked_items FOR ALL TO public USING (true) WITH CHECK (true);
