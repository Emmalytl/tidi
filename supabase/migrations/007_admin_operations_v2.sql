-- TIDYLINE ADMIN V2 OPERATIONS
-- Adds reliable one-by-one audit deletion for the Admin Audit Tray.
-- Run after 006_staff_profiles_reset_and_management.sql.

DROP FUNCTION IF EXISTS public.delete_audit_log(bigint);
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

REVOKE ALL ON FUNCTION public.delete_audit_log(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_audit_log(bigint) TO authenticated;

-- Keep the existing clear-all and reset functions available to the Admin.
GRANT EXECUTE ON FUNCTION public.clear_audit_history() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_tidyline_system(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_booking(text) TO authenticated;
