-- Fix get_user_id_by_email to be case-insensitive and trimmed
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(email_addr text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_uid uuid;
BEGIN
  SELECT id INTO target_uid 
  FROM auth.users 
  WHERE LOWER(email) = LOWER(TRIM(email_addr));
  RETURN target_uid;
END;
$$;
