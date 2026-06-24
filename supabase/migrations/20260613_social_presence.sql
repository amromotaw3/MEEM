-- Migration: Social Presence and Chat/Notes
-- Target Database: Supabase

-- 1. Create collection_messages table
CREATE TABLE IF NOT EXISTS public.collection_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID NOT NULL REFERENCES public.custom_lists(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES public.account_profiles(id) ON DELETE CASCADE,
    message_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on collection_messages
ALTER TABLE public.collection_messages ENABLE ROW LEVEL SECURITY;

-- 2. Create RLS Policies for collection_messages
-- Check if a profile belongs to an authenticated user who is either the owner or a joined member of the list
CREATE OR REPLACE FUNCTION public.is_list_participant(list_uuid UUID, user_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.custom_lists 
        WHERE id = list_uuid AND profile_id IN (SELECT id FROM public.account_profiles WHERE user_id = user_uuid)
    ) OR EXISTS (
        SELECT 1 FROM public.list_members 
        WHERE list_id = list_uuid AND user_id = user_uuid AND status = 'joined'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- SELECT policy: Users can read messages if they are participants
CREATE POLICY select_collection_messages ON public.collection_messages
    FOR SELECT
    USING (public.is_list_participant(list_id, auth.uid()));

-- INSERT policy: Users can insert messages if they are participants and the profile matches their profile
CREATE POLICY insert_collection_messages ON public.collection_messages
    FOR INSERT
    WITH CHECK (
        public.is_list_participant(list_id, auth.uid())
        AND profile_id IN (SELECT id FROM public.account_profiles WHERE user_id = auth.uid())
    );

-- 3. Update RLS policies for playback_history
-- Check if two profiles share at least one custom_list (either as owner or joined member)
CREATE OR REPLACE FUNCTION public.share_custom_list(profile_id_a UUID, profile_id_b UUID)
RETURNS BOOLEAN AS $$
DECLARE
    user_id_a UUID;
    user_id_b UUID;
BEGIN
    SELECT user_id INTO user_id_a FROM public.account_profiles WHERE id = profile_id_a;
    SELECT user_id INTO user_id_b FROM public.account_profiles WHERE id = profile_id_b;
    
    IF user_id_a IS NULL OR user_id_b IS NULL THEN
        RETURN FALSE;
    END IF;

    IF user_id_a = user_id_b THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        -- Find a list that relates to both users
        SELECT 1 
        FROM public.custom_lists cl
        WHERE 
            -- A is owner, B is member
            (cl.profile_id = profile_id_a AND cl.id IN (SELECT list_id FROM public.list_members WHERE user_id = user_id_b AND status = 'joined'))
            OR
            -- B is owner, A is member
            (cl.profile_id = profile_id_b AND cl.id IN (SELECT list_id FROM public.list_members WHERE user_id = user_id_a AND status = 'joined'))
            OR
            -- Both A and B are members of the same list
            (cl.id IN (SELECT list_id FROM public.list_members WHERE user_id = user_id_a AND status = 'joined')
             AND cl.id IN (SELECT list_id FROM public.list_members WHERE user_id = user_id_b AND status = 'joined'))
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allow users to SELECT playback_history if they share a list
CREATE POLICY select_playback_history_shared ON public.playback_history
    FOR SELECT
    USING (
        profile_id IN (SELECT id FROM public.account_profiles WHERE user_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.account_profiles ap
            WHERE ap.user_id = auth.uid() AND public.share_custom_list(ap.id, playback_history.profile_id)
        )
    );

-- 4. Enable Supabase Realtime for collection_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.collection_messages;
