-- TIDYLINE ADMIN RELIABILITY PATCH
-- Safe to run on an existing installation. Creates missing Admin RPCs and permissions.

CREATE OR REPLACE FUNCTION public.clear_audit_history()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.activity_log;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.clear_audit_history() TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_audit_log(p_log_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.activity_log WHERE id = p_log_id;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_audit_log(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_booking(p_booking_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.bookings WHERE id::text = p_booking_id OR booking_ref = p_booking_id;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_booking(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reset_tidyline_system(p_confirmation text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
  targets text[] := ARRAY['activity_log','staff_availability','invoices','bookings','customers','staff'];
BEGIN
  IF p_confirmation <> 'RESET TIDYLINE' THEN
    RAISE EXCEPTION 'Invalid reset confirmation';
  END IF;

  FOREACH t IN ARRAY targets LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', t);
    END IF;
  END LOOP;

  IF to_regclass('public.settings') IS NOT NULL THEN
    UPDATE public.settings
      SET company_name='Tidyline',
          price_standard=45,
          price_deep=65,
          price_moveinout=55,
          price_office=50,
          currency='USD',
          updated_at=now()
      WHERE id=1;
  END IF;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_tidyline_system(text) TO authenticated;
