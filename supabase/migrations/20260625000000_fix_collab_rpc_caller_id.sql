-- MediaVault — collaboration RPC + security/perf hardening.
--
-- The Electron/Android client logs in via handle_secure_login (custom users_accounts
-- auth, no Supabase JWT), so auth.uid() is NULL on the anon client. The client passes
-- the caller's users_accounts.id as `caller_id`. The deployed DB already accepts
-- caller_id; this migration brings the repo in sync and adds safe hardening:
--   1. search_collaborators: restore email search (was name-only) + robust email source
--   2. get_user_id_by_email: resolve from users_accounts first (handle_register always
--      writes it), falling back to auth.users
--   3. get_pending_invitations: kept in sync (already correct in DB)
--   4. SET search_path on functions flagged by the linter (function_search_path_mutable)
--   5. Indexes for unindexed foreign keys (performance)
--
-- All changes are non-destructive (CREATE OR REPLACE / ALTER / CREATE INDEX IF NOT EXISTS).

-- ============================================================
-- 1. search_collaborators(query_str, caller_id)
-- ============================================================
DROP FUNCTION IF EXISTS public.search_collaborators(text);
DROP FUNCTION IF EXISTS public.search_collaborators(text, uuid);

CREATE OR REPLACE FUNCTION public.search_collaborators(
  query_str text,
  caller_id uuid DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  email text,
  profile_name text,
  allow_invitations boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.search_collaborators(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_collaborators(text, uuid) TO anon, authenticated, service_role;

-- ============================================================
-- 2. get_user_id_by_email
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(email_addr text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ============================================================
-- 3. get_pending_invitations(caller_id) — kept in sync with deployed DB
-- ============================================================
DROP FUNCTION IF EXISTS public.get_pending_invitations();
DROP FUNCTION IF EXISTS public.get_pending_invitations(uuid);

CREATE OR REPLACE FUNCTION public.get_pending_invitations(
  caller_id uuid DEFAULT NULL
)
RETURNS TABLE (
  membership_id uuid,
  list_id uuid,
  list_name text,
  invited_by_profile_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.get_pending_invitations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_invitations(uuid) TO anon, authenticated, service_role;

-- ============================================================
-- 4. SET search_path on linter-flagged functions (function_search_path_mutable)
-- ============================================================
ALTER FUNCTION public.create_profile(uuid, text, text, integer, text) SET search_path = public;
ALTER FUNCTION public.fetch_media_for_profile(uuid) SET search_path = public;
ALTER FUNCTION public.is_list_participant(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.share_custom_list(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.upsert_profile(uuid, uuid, text, text, integer, text, jsonb, jsonb, text, jsonb, jsonb, jsonb) SET search_path = public;

-- ============================================================
-- 5. Indexes for unindexed foreign keys (performance)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_account_profiles_user_id ON public.account_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_messages_list_id ON public.collection_messages(list_id);
CREATE INDEX IF NOT EXISTS idx_collection_messages_profile_id ON public.collection_messages(profile_id);
CREATE INDEX IF NOT EXISTS idx_list_members_user_id ON public.list_members(user_id);
