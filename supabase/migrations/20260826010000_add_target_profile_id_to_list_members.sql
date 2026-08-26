-- Add target_profile_id column to list_members table to associate shared collections with specific profiles
ALTER TABLE public.list_members ADD COLUMN IF NOT EXISTS target_profile_id uuid REFERENCES public.account_profiles(id) ON DELETE CASCADE;
