-- 1. Drop old policies to prevent conflicts
DROP POLICY IF EXISTS "Members can view custom lists" ON public.custom_lists;
DROP POLICY IF EXISTS "Owners can manage their own custom lists" ON public.custom_lists;
DROP POLICY IF EXISTS "Users can view members of lists they belong to or own" ON public.list_members;
DROP POLICY IF EXISTS "Owners can insert list members" ON public.list_members;
DROP POLICY IF EXISTS "Owners or members can update list members" ON public.list_members;
DROP POLICY IF EXISTS "Owners or members can delete list members" ON public.list_members;
DROP POLICY IF EXISTS "Only list owners can manage list members" ON public.list_members;
DROP POLICY IF EXISTS "Owners can manage list items" ON public.list_items;
DROP POLICY IF EXISTS "Members can view list items" ON public.list_items;
DROP POLICY IF EXISTS "Members can insert list items" ON public.list_items;
DROP POLICY IF EXISTS "Members can delete list items" ON public.list_items;

-- 2. Create security definer helper functions to bypass RLS and break circular dependency
CREATE OR REPLACE FUNCTION public.is_list_owner(p_list_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.custom_lists c
    JOIN public.account_profiles p ON c.profile_id = p.id
    WHERE c.id = p_list_id AND p.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_list_member(p_list_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.list_members
    WHERE list_id = p_list_id AND user_id = p_user_id AND status = 'joined'
  );
$$;

-- 3. Create clean RLS policies for custom_lists
CREATE POLICY "Owners can manage their own custom lists"
ON public.custom_lists
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.account_profiles
    WHERE account_profiles.id = custom_lists.profile_id AND account_profiles.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.account_profiles
    WHERE account_profiles.id = custom_lists.profile_id AND account_profiles.user_id = auth.uid()
  )
);

CREATE POLICY "Members can view custom lists"
ON public.custom_lists
FOR SELECT
TO authenticated
USING (
  public.is_list_member(id, auth.uid())
);

-- 4. Create clean RLS policies for list_members
CREATE POLICY "Users can view members of lists they belong to or own"
ON public.list_members
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid() OR public.is_list_owner(list_id, auth.uid())
);

CREATE POLICY "Owners can insert list members"
ON public.list_members
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_list_owner(list_id, auth.uid())
);

CREATE POLICY "Owners or members can update list members"
ON public.list_members
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid() OR public.is_list_owner(list_id, auth.uid())
)
WITH CHECK (
  user_id = auth.uid() OR public.is_list_owner(list_id, auth.uid())
);

CREATE POLICY "Owners or members can delete list members"
ON public.list_members
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid() OR public.is_list_owner(list_id, auth.uid())
);

-- 5. Create clean RLS policies for list_items
CREATE POLICY "Owners can manage list items"
ON public.list_items
FOR ALL
TO authenticated
USING (
  public.is_list_owner(list_id, auth.uid())
)
WITH CHECK (
  public.is_list_owner(list_id, auth.uid())
);

CREATE POLICY "Members can view list items"
ON public.list_items
FOR SELECT
TO authenticated
USING (
  public.is_list_member(list_id, auth.uid())
);

CREATE POLICY "Members can insert list items"
ON public.list_items
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_list_member(list_id, auth.uid())
);

CREATE POLICY "Members can delete list items"
ON public.list_items
FOR DELETE
TO authenticated
USING (
  public.is_list_member(list_id, auth.uid())
);
