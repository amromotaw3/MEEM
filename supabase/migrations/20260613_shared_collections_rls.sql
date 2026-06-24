-- SQL Migration: Update RLS Policies for custom_lists and list_items
-- Target Database: Supabase

-- 1. Update SELECT policy on custom_lists to allow joined participants to read the list
DROP POLICY IF EXISTS select_custom_lists_participant ON public.custom_lists;
CREATE POLICY select_custom_lists_participant ON public.custom_lists
    FOR SELECT
    USING (
        profile_id IN (SELECT id FROM public.account_profiles WHERE user_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.list_members 
            WHERE list_id = id AND user_id = auth.uid() AND status = 'joined'
        )
    );

-- 2. Update SELECT policy on list_items to allow joined participants to read list items
DROP POLICY IF EXISTS select_list_items_participant ON public.list_items;
CREATE POLICY select_list_items_participant ON public.list_items
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.custom_lists 
            WHERE id = list_items.list_id AND (
                profile_id IN (SELECT id FROM public.account_profiles WHERE user_id = auth.uid())
                OR EXISTS (
                    SELECT 1 FROM public.list_members 
                    WHERE list_id = list_items.list_id AND user_id = auth.uid() AND status = 'joined'
                )
            )
        )
    );
