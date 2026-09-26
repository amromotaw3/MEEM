-- Migration: Fix Bug Reports Admin Access & Full Inbox Retrieval
-- Description: Ensures admins can view all submitted bug reports across all users, and non-admins only see submission form

CREATE OR REPLACE FUNCTION public.is_admin_user(p_email TEXT DEFAULT NULL, p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_email TEXT;
BEGIN
    -- 1. Direct check of passed email parameter
    v_email := lower(trim(coalesce(p_email, '')));
    IF v_email IN ('amro.motawa@icloud.com', 'amromotaw3@gmail.com', 'amro.motawa@gmail.com') THEN
        RETURN TRUE;
    END IF;

    -- 2. Direct check of Supabase JWT auth claims
    IF auth.jwt() ->> 'email' IS NOT NULL THEN
        IF lower(trim(auth.jwt() ->> 'email')) IN ('amro.motawa@icloud.com', 'amromotaw3@gmail.com', 'amro.motawa@gmail.com') THEN
            RETURN TRUE;
        END IF;
    END IF;

    -- 3. Check public.users_accounts by email
    IF v_email != '' THEN
        IF EXISTS (
            SELECT 1 FROM public.users_accounts 
            WHERE lower(trim(email)) = v_email AND (role = 'admin' OR lower(trim(email)) IN ('amro.motawa@icloud.com', 'amromotaw3@gmail.com', 'amro.motawa@gmail.com'))
        ) THEN
            RETURN TRUE;
        END IF;
    END IF;

    -- 4. Check public.users_accounts by user_id
    IF p_user_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.users_accounts 
            WHERE id = p_user_id AND (role = 'admin' OR lower(trim(email)) IN ('amro.motawa@icloud.com', 'amromotaw3@gmail.com', 'amro.motawa@gmail.com'))
        ) THEN
            RETURN TRUE;
        END IF;
    END IF;

    -- 5. Check public.users_accounts by auth.uid()
    IF auth.uid() IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.users_accounts 
            WHERE id = auth.uid() AND (role = 'admin' OR lower(trim(email)) IN ('amro.motawa@icloud.com', 'amromotaw3@gmail.com', 'amro.motawa@gmail.com'))
        ) THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
END;
$$;

-- Replace get_bug_reports RPC to guarantee all records are returned for any admin
CREATE OR REPLACE FUNCTION public.get_bug_reports(
    p_user_email TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_category TEXT DEFAULT NULL,
    p_limit INT DEFAULT 100,
    p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_reports JSONB;
    v_total_count INT;
    v_open_count INT;
    v_in_progress_count INT;
    v_resolved_count INT;
BEGIN
    v_is_admin := public.is_admin_user(p_user_email, p_user_id);
    
    IF NOT v_is_admin THEN
        -- If not admin, only return the user's own reports and empty admin stats
        SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb)
        INTO v_reports
        FROM (
            SELECT * FROM public.bug_reports
            WHERE (p_user_id IS NOT NULL AND user_id = p_user_id)
               OR (p_user_email IS NOT NULL AND length(trim(p_user_email)) > 0 AND lower(trim(user_email)) = lower(trim(p_user_email)))
            ORDER BY created_at DESC
            LIMIT p_limit OFFSET p_offset
        ) r;

        RETURN jsonb_build_object(
            'success', true,
            'is_admin', false,
            'reports', v_reports,
            'stats', jsonb_build_object('total', 0, 'open', 0, 'in_progress', 0, 'resolved', 0)
        );
    END IF;

    -- Stats calculation for admin (ALL reports across all users)
    SELECT count(*)::int INTO v_total_count FROM public.bug_reports;
    SELECT count(*)::int INTO v_open_count FROM public.bug_reports WHERE status = 'open';
    SELECT count(*)::int INTO v_in_progress_count FROM public.bug_reports WHERE status = 'in_progress';
    SELECT count(*)::int INTO v_resolved_count FROM public.bug_reports WHERE status IN ('resolved', 'closed');

    -- Filtered reports (ALL reports from ALL users)
    SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_reports
    FROM (
        SELECT * FROM public.bug_reports
        WHERE (p_status IS NULL OR p_status = '' OR p_status = 'all' OR status = p_status)
          AND (p_category IS NULL OR p_category = '' OR p_category = 'all' OR category = p_category)
        ORDER BY created_at DESC
        LIMIT p_limit OFFSET p_offset
    ) r;

    RETURN jsonb_build_object(
        'success', true,
        'is_admin', true,
        'reports', v_reports,
        'stats', jsonb_build_object(
            'total', v_total_count,
            'open', v_open_count,
            'in_progress', v_in_progress_count,
            'resolved', v_resolved_count
        )
    );
END;
$$;
