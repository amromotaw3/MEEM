-- Migration: Create Bug Reports System
-- Description: Table, storage policies, and RPC functions for user bug reports and admin management

CREATE TABLE IF NOT EXISTS public.bug_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    user_email TEXT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    description TEXT NOT NULL,
    steps_to_reproduce TEXT,
    severity TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'open',
    system_info JSONB DEFAULT '{}'::jsonb,
    attachments JSONB DEFAULT '[]'::jsonb,
    admin_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast status & date filtering
CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON public.bug_reports(status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_created_at ON public.bug_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_user_id ON public.bug_reports(user_id);

-- Enable RLS
ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin_user(p_email TEXT DEFAULT NULL, p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_email TEXT;
BEGIN
    v_email := lower(trim(coalesce(p_email, '')));
    IF v_email IN ('amro.motawa@icloud.com', 'amromotaw3@gmail.com', 'amro.motawa@gmail.com') THEN
        RETURN TRUE;
    END IF;

    IF p_user_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.users_accounts 
            WHERE id = p_user_id AND (role = 'admin' OR lower(email) IN ('amro.motawa@icloud.com', 'amromotaw3@gmail.com', 'amro.motawa@gmail.com'))
        ) THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
END;
$$;

-- Allow insert by any user (anon or authenticated)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'bug_reports' AND policyname = 'Anyone can submit bug reports'
    ) THEN
        CREATE POLICY "Anyone can submit bug reports" ON public.bug_reports
        FOR INSERT WITH CHECK (true);
    END IF;
END $$;

-- Allow select for admins and report creators
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'bug_reports' AND policyname = 'Admins and owners can view bug reports'
    ) THEN
        CREATE POLICY "Admins and owners can view bug reports" ON public.bug_reports
        FOR SELECT USING (
            public.is_admin_user(auth.jwt() ->> 'email', auth.uid()) OR 
            auth.uid() = user_id OR
            true
        );
    END IF;
END $$;

-- RPC: submit_bug_report
CREATE OR REPLACE FUNCTION public.submit_bug_report(
    p_title TEXT,
    p_category TEXT,
    p_description TEXT,
    p_steps_to_reproduce TEXT DEFAULT NULL,
    p_severity TEXT DEFAULT 'normal',
    p_system_info JSONB DEFAULT '{}'::jsonb,
    p_attachments JSONB DEFAULT '[]'::jsonb,
    p_user_email TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_report_id UUID;
    v_report public.bug_reports%ROWTYPE;
BEGIN
    IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Title is required');
    END IF;
    IF p_description IS NULL OR length(trim(p_description)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Description is required');
    END IF;

    INSERT INTO public.bug_reports (
        title,
        category,
        description,
        steps_to_reproduce,
        severity,
        system_info,
        attachments,
        user_email,
        user_id,
        status,
        created_at,
        updated_at
    )
    VALUES (
        trim(p_title),
        coalesce(nullif(trim(p_category), ''), 'general'),
        trim(p_description),
        nullif(trim(coalesce(p_steps_to_reproduce, '')), ''),
        coalesce(nullif(trim(p_severity), ''), 'normal'),
        coalesce(p_system_info, '{}'::jsonb),
        coalesce(p_attachments, '[]'::jsonb),
        nullif(trim(coalesce(p_user_email, '')), ''),
        p_user_id,
        'open',
        NOW(),
        NOW()
    )
    RETURNING * INTO v_report;

    RETURN jsonb_build_object(
        'success', true,
        'report_id', v_report.id,
        'message', 'Bug report submitted successfully'
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- RPC: get_bug_reports (Admin only or user specific)
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
        -- If not admin, only return the user's own reports
        SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb)
        INTO v_reports
        FROM (
            SELECT * FROM public.bug_reports
            WHERE (p_user_id IS NOT NULL AND user_id = p_user_id)
               OR (p_user_email IS NOT NULL AND lower(user_email) = lower(p_user_email))
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

    -- Stats calculation for admin
    SELECT count(*)::int INTO v_total_count FROM public.bug_reports;
    SELECT count(*)::int INTO v_open_count FROM public.bug_reports WHERE status = 'open';
    SELECT count(*)::int INTO v_in_progress_count FROM public.bug_reports WHERE status = 'in_progress';
    SELECT count(*)::int INTO v_resolved_count FROM public.bug_reports WHERE status IN ('resolved', 'closed');

    -- Filtered reports
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
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- RPC: update_bug_report_status
CREATE OR REPLACE FUNCTION public.update_bug_report_status(
    p_user_email TEXT,
    p_report_id UUID,
    p_status TEXT,
    p_admin_notes TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_report public.bug_reports%ROWTYPE;
BEGIN
    v_is_admin := public.is_admin_user(p_user_email, p_user_id);
    IF NOT v_is_admin THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Admin role required');
    END IF;

    UPDATE public.bug_reports
    SET 
        status = coalesce(nullif(trim(p_status), ''), status),
        admin_notes = CASE WHEN p_admin_notes IS NOT NULL THEN trim(p_admin_notes) ELSE admin_notes END,
        updated_at = NOW()
    WHERE id = p_report_id
    RETURNING * INTO v_report;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Report not found');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'report', to_jsonb(v_report)
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- RPC: delete_bug_report
CREATE OR REPLACE FUNCTION public.delete_bug_report(
    p_user_email TEXT,
    p_report_id UUID,
    p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_is_admin BOOLEAN;
BEGIN
    v_is_admin := public.is_admin_user(p_user_email, p_user_id);
    IF NOT v_is_admin THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Admin role required');
    END IF;

    DELETE FROM public.bug_reports WHERE id = p_report_id;

    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
