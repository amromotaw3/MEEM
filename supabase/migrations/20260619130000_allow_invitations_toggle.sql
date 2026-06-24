-- 1. Add allow_invitations column to users_accounts
ALTER TABLE public.users_accounts ADD COLUMN IF NOT EXISTS allow_invitations boolean DEFAULT true;

-- 2. Create helper to check if a user allows invitations
CREATE OR REPLACE FUNCTION public.user_allows_invites(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(allow_invitations, true) 
  FROM public.users_accounts 
  WHERE id = p_user_id;
$$;

-- 3. Update list_members insert policy to enforce allow_invitations
DROP POLICY IF EXISTS "Owners can insert list members" ON public.list_members;
CREATE POLICY "Owners can insert list members"
ON public.list_members
FOR INSERT
TO authenticated
WITH CHECK (
  is_list_owner(list_id, auth.uid()) AND user_allows_invites(user_id)
);

-- 4. Create get_user_id_by_username RPC
DROP FUNCTION IF EXISTS public.get_user_id_by_username(text);
CREATE OR REPLACE FUNCTION public.get_user_id_by_username(username_val text)
RETURNS TABLE (
  user_id uuid,
  allow_invitations boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.user_id, COALESCE(u.allow_invitations, true) AS allow_invitations
  FROM public.account_profiles p
  LEFT JOIN public.users_accounts u ON u.id = p.user_id
  WHERE LOWER(TRIM(p.name)) = LOWER(TRIM(username_val))
  LIMIT 1;
END;
$$;

-- 5. Drop and recreate search_collaborators RPC to return allow_invitations
DROP FUNCTION IF EXISTS public.search_collaborators(text);
CREATE OR REPLACE FUNCTION public.search_collaborators(query_str text)
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
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    p.user_id,
    COALESCE(au.email, '')::text AS email,
    p.name::text AS profile_name,
    COALESCE(u.allow_invitations, true) AS allow_invitations
  FROM public.account_profiles p
  LEFT JOIN auth.users au ON au.id = p.user_id
  LEFT JOIN public.users_accounts u ON u.id = p.user_id
  WHERE 
    (au.email ILIKE '%' || query_str || '%' OR p.name ILIKE '%' || query_str || '%')
    AND p.user_id <> auth.uid()
  LIMIT 10;
END;
$$;
