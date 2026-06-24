-- SQL Migration: Sync playback_history to watchlist_items and update RLS policies
-- Target Database: Supabase

-- 1. Create select policy for watchlist_items shared with friends
DROP POLICY IF EXISTS select_watchlist_items_shared ON public.watchlist_items;
CREATE POLICY select_watchlist_items_shared ON public.watchlist_items
    FOR SELECT
    USING (
        profile_id IN (SELECT id FROM public.account_profiles WHERE user_id = auth.uid())
        OR EXISTS (
            SELECT 1 FROM public.account_profiles ap
            WHERE ap.user_id = auth.uid() AND public.share_custom_list(ap.id, watchlist_items.profile_id)
        )
    );

-- 2. Copy Movie data from playback_history to watchlist_items (media_id does not contain ':')
INSERT INTO public.watchlist_items (profile_id, media_id, type, title, added_at)
SELECT 
    profile_id, 
    media_id,
    'movie' AS type,
    'Imported Item' AS title,
    last_watched_at AS added_at
FROM public.playback_history
WHERE media_id NOT LIKE '%:%'
ON CONFLICT (profile_id, media_id) DO NOTHING;

-- 3. Copy TV Show data from playback_history to watchlist_items (media_id contains ':')
-- Extract base TV show ID and set the correct type ('series')
INSERT INTO public.watchlist_items (profile_id, media_id, type, title, added_at)
SELECT 
    profile_id, 
    split_part(media_id, ':', 1) AS media_id,
    'series' AS type,
    'Imported Item' AS title,
    last_watched_at AS added_at
FROM public.playback_history
WHERE media_id LIKE '%:%'
ON CONFLICT (profile_id, media_id) DO NOTHING;
