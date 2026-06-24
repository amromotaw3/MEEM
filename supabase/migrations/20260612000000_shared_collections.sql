-- 1. Create list_members table
CREATE TABLE IF NOT EXISTS public.list_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid REFERENCES public.custom_lists(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users_accounts(id) ON DELETE CASCADE,
  role text DEFAULT 'member',
  joined_at timestamp with time zone DEFAULT now(),
  UNIQUE(list_id, user_id)
);

-- Enable RLS on list_members
ALTER TABLE public.list_members ENABLE ROW LEVEL SECURITY;

-- Policies for list_members
DROP POLICY IF EXISTS "Users can view members of lists they belong to or own" ON public.list_members;
CREATE POLICY "Users can view members of lists they belong to or own"
ON public.list_members
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.custom_lists c
    JOIN public.account_profiles p ON c.profile_id = p.id
    WHERE c.id = list_members.list_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Only list owners can manage list members" ON public.list_members;
CREATE POLICY "Only list owners can manage list members"
ON public.list_members
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.custom_lists c
    JOIN public.account_profiles p ON c.profile_id = p.id
    WHERE c.id = list_members.list_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.custom_lists c
    JOIN public.account_profiles p ON c.profile_id = p.id
    WHERE c.id = list_members.list_id AND p.user_id = auth.uid()
  )
);

-- 2. Recreate custom_lists policies
DROP POLICY IF EXISTS "Users can manage their own custom lists" ON public.custom_lists;
DROP POLICY IF EXISTS "Owners can manage their own custom lists" ON public.custom_lists;
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

DROP POLICY IF EXISTS "Members can view custom lists" ON public.custom_lists;
CREATE POLICY "Members can view custom lists"
ON public.custom_lists
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.list_members
    WHERE list_members.list_id = custom_lists.id AND list_members.user_id = auth.uid()
  )
);

-- 3. Recreate list_items policies
DROP POLICY IF EXISTS "Users can manage their own list items" ON public.list_items;
DROP POLICY IF EXISTS "Owners can manage list items" ON public.list_items;
CREATE POLICY "Owners can manage list items"
ON public.list_items
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.custom_lists c
    JOIN public.account_profiles p ON c.profile_id = p.id
    WHERE c.id = list_items.list_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.custom_lists c
    JOIN public.account_profiles p ON c.profile_id = p.id
    WHERE c.id = list_items.list_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Members can view list items" ON public.list_items;
CREATE POLICY "Members can view list items"
ON public.list_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.list_members
    WHERE list_members.list_id = list_items.list_id AND list_members.user_id = auth.uid()
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
    WHERE list_members.list_id = list_items.list_id AND list_members.user_id = auth.uid()
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
    WHERE list_members.list_id = list_items.list_id AND list_members.user_id = auth.uid()
  )
);

-- Enable publication addition for realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.list_items;

-- Set replica identity to FULL to include all columns in DELETE realtime payload
ALTER TABLE public.list_items REPLICA IDENTITY FULL;

-- 4. Create function to resolve email to user_id safely (bypassing RLS)
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(email_addr text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_uid uuid;
BEGIN
  SELECT id INTO target_uid FROM auth.users WHERE email = email_addr;
  RETURN target_uid;
END;
$$;
