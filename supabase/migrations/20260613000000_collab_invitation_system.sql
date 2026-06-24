-- 1. Add status column to list_members
ALTER TABLE public.list_members ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';

-- Update existing memberships to joined
UPDATE public.list_members SET status = 'joined' WHERE status IS NULL OR status = 'pending';

-- Add check constraint for status values
ALTER TABLE public.list_members DROP CONSTRAINT IF EXISTS check_status_values;
ALTER TABLE public.list_members ADD CONSTRAINT check_status_values CHECK (status IN ('pending', 'joined'));

-- 2. Drop existing list_members manage policy
DROP POLICY IF EXISTS "Only list owners can manage list members" ON public.list_members;

-- Create individual policies for list_members write operations
CREATE POLICY "Owners can insert list members"
ON public.list_members
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.custom_lists c
    JOIN public.account_profiles p ON c.profile_id = p.id
    WHERE c.id = list_members.list_id AND p.user_id = auth.uid()
  )
);

CREATE POLICY "Owners or members can update list members"
ON public.list_members
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.custom_lists c
    JOIN public.account_profiles p ON c.profile_id = p.id
    WHERE c.id = list_members.list_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.custom_lists c
    JOIN public.account_profiles p ON c.profile_id = p.id
    WHERE c.id = list_members.list_id AND p.user_id = auth.uid()
  )
);

CREATE POLICY "Owners or members can delete list members"
ON public.list_members
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.custom_lists c
    JOIN public.account_profiles p ON c.profile_id = p.id
    WHERE c.id = list_members.list_id AND p.user_id = auth.uid()
  )
);

-- 3. Recreate list_items select/insert/delete policies to enforce status = 'joined'
DROP POLICY IF EXISTS "Members can view list items" ON public.list_items;
CREATE POLICY "Members can view list items"
ON public.list_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.list_members
    WHERE list_members.list_id = list_items.list_id AND list_members.user_id = auth.uid() AND list_members.status = 'joined'
  )
);

DROP POLICY IF EXISTS "Members can insert list items" ON public.list_items;
CREATE POLICY "Members can insert list items"
ON public.list_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.list_members
    WHERE list_members.list_id = list_items.list_id AND list_members.user_id = auth.uid() AND list_members.status = 'joined'
  )
);

DROP POLICY IF EXISTS "Members can delete list items" ON public.list_items;
CREATE POLICY "Members can delete list items"
ON public.list_items
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.list_members
    WHERE list_members.list_id = list_items.list_id AND list_members.user_id = auth.uid() AND list_members.status = 'joined'
  )
);

-- 4. Create search_collaborators RPC function
CREATE OR REPLACE FUNCTION public.search_collaborators(query_str text)
RETURNS TABLE (
  user_id uuid,
  email text,
  profile_name text
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
    p.name::text AS profile_name
  FROM public.account_profiles p
  LEFT JOIN auth.users au ON au.id = p.user_id
  WHERE 
    (au.email ILIKE '%' || query_str || '%' OR p.name ILIKE '%' || query_str || '%')
    AND p.user_id <> auth.uid()
  LIMIT 10;
END;
$$;

-- 5. Create get_pending_invitations RPC function
CREATE OR REPLACE FUNCTION public.get_pending_invitations()
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
  IF auth.uid() IS NULL THEN
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
  WHERE m.user_id = auth.uid() AND m.status = 'pending';
END;
$$;
