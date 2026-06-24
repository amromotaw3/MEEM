-- Migration: Fix Social Navigation and RLS Policies for Profiles and Members
-- Target Database: Supabase

-- 1. Update SELECT policy for account_profiles
-- Allow all authenticated users to read profile details (name, avatar) so collaborator names and chat senders show up.
DROP POLICY IF EXISTS "Users can select their own profile" ON public.account_profiles;
DROP POLICY IF EXISTS "Users can select all profiles" ON public.account_profiles;
CREATE POLICY "Users can select all profiles" ON public.account_profiles 
    FOR SELECT 
    TO authenticated 
    USING (true);

-- 2. Update SELECT policy for list_members
-- Allow users to view membership entries of a list if they belong to that list, own that list, or if the entry belongs to them.
DROP POLICY IF EXISTS "Users can view members of lists they belong to or own" ON public.list_members;
CREATE POLICY "Users can view members of lists they belong to or own" ON public.list_members
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid() 
        OR public.is_list_owner(list_id, auth.uid()) 
        OR public.is_list_member(list_id, auth.uid())
    );
