-- Custom lists fallback for joined / shared lists in get_profile_data_by_hardware RPC
CREATE OR REPLACE FUNCTION public.get_profile_data_by_hardware(
  p_hardware_id text,
  p_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_watchlist jsonb;
  v_playback jsonb;
  v_locked jsonb;
  v_lists jsonb;
BEGIN
  -- Verify hardware_id maps to a valid, non-banned device and user
  SELECT ud.user_id INTO v_user_id
  FROM public.user_devices ud
  JOIN public.users_accounts ua ON ua.id = ud.user_id
  WHERE ud.hardware_id = trim(p_hardware_id)
    AND ua.is_banned = false
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Device not authorized');
  END IF;

  -- Verify the profile belongs to this user
  IF NOT EXISTS (
    SELECT 1 FROM public.account_profiles ap
    WHERE ap.id = p_profile_id AND ap.user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('error', 'Profile not found for this device');
  END IF;

  -- Fetch watchlist_items
  SELECT COALESCE(jsonb_agg(to_jsonb(w)), '[]'::jsonb)
  INTO v_watchlist
  FROM public.watchlist_items w
  WHERE w.profile_id = p_profile_id;

  -- Fetch playback_history
  SELECT COALESCE(jsonb_agg(to_jsonb(ph)), '[]'::jsonb)
  INTO v_playback
  FROM public.playback_history ph
  WHERE ph.profile_id = p_profile_id;

  -- Fetch locked_items
  SELECT COALESCE(jsonb_agg(to_jsonb(li)), '[]'::jsonb)
  INTO v_locked
  FROM public.locked_items li
  WHERE li.profile_id = p_profile_id;

  -- Fetch custom_lists with list_items (owned or joined)
  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(cl) || jsonb_build_object(
        'list_items', (
          SELECT COALESCE(jsonb_agg(to_jsonb(litem)), '[]'::jsonb)
          FROM public.list_items litem
          WHERE litem.list_id = cl.id
        )
      )
    ),
    '[]'::jsonb
  )
  INTO v_lists
  FROM public.custom_lists cl
  WHERE cl.profile_id = p_profile_id
     OR EXISTS (
       SELECT 1 FROM public.list_members lm
       WHERE lm.list_id = cl.id
         AND lm.user_id = v_user_id
         AND lm.status = 'joined'
     );

  RETURN jsonb_build_object(
    'watchlist_items', v_watchlist,
    'playback_history', v_playback,
    'locked_items', v_locked,
    'custom_lists', v_lists
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.get_profile_data_by_hardware(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_data_by_hardware(text, uuid) TO anon, authenticated, service_role;
