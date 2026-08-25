-- TIDYLINE FINAL ADMIN ↔ STAFF INTEGRATION
-- Run after the existing Tidyline migrations.
-- Adds secure admin approval RPCs for staff availability requests and
-- restricts destructive Admin RPCs so a linked staff account cannot call them.

CREATE OR REPLACE FUNCTION public.tidyline_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.staff s
       WHERE s.auth_user_id = auth.uid() AND s.active = true
     );
$$;
GRANT EXECUTE ON FUNCTION public.tidyline_is_admin() TO authenticated;

-- Secure the existing destructive RPCs. Return types remain boolean.
DROP FUNCTION IF EXISTS public.clear_audit_history();
CREATE FUNCTION public.clear_audit_history()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.tidyline_is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  DELETE FROM public.activity_log;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.clear_audit_history() TO authenticated;

DROP FUNCTION IF EXISTS public.delete_audit_log(bigint);
CREATE FUNCTION public.delete_audit_log(p_log_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.tidyline_is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  DELETE FROM public.activity_log WHERE id = p_log_id;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_audit_log(bigint) TO authenticated;

DROP FUNCTION IF EXISTS public.delete_booking(text);
CREATE FUNCTION public.delete_booking(p_booking_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.tidyline_is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  DELETE FROM public.bookings WHERE id::text = p_booking_id OR booking_ref = p_booking_id;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_booking(text) TO authenticated;

DROP FUNCTION IF EXISTS public.reset_tidyline_system(text);
CREATE FUNCTION public.reset_tidyline_system(p_confirmation text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.tidyline_is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_confirmation <> 'RESET TIDYLINE' THEN RAISE EXCEPTION 'Invalid reset confirmation'; END IF;
  IF to_regclass('public.activity_log') IS NOT NULL THEN TRUNCATE TABLE public.activity_log RESTART IDENTITY CASCADE; END IF;
  IF to_regclass('public.staff_availability_requests') IS NOT NULL THEN TRUNCATE TABLE public.staff_availability_requests RESTART IDENTITY CASCADE; END IF;
  IF to_regclass('public.staff_availability') IS NOT NULL THEN TRUNCATE TABLE public.staff_availability RESTART IDENTITY CASCADE; END IF;
  IF to_regclass('public.invoices') IS NOT NULL THEN TRUNCATE TABLE public.invoices RESTART IDENTITY CASCADE; END IF;
  IF to_regclass('public.bookings') IS NOT NULL THEN TRUNCATE TABLE public.bookings RESTART IDENTITY CASCADE; END IF;
  IF to_regclass('public.customers') IS NOT NULL THEN TRUNCATE TABLE public.customers RESTART IDENTITY CASCADE; END IF;
  IF to_regclass('public.staff') IS NOT NULL THEN TRUNCATE TABLE public.staff RESTART IDENTITY CASCADE; END IF;
  IF to_regclass('public.settings') IS NOT NULL THEN
    UPDATE public.settings SET company_name='Tidyline', price_standard=45, price_deep=65, price_moveinout=55, price_office=50, currency='USD', updated_at=now() WHERE id=1;
  END IF;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_tidyline_system(text) TO authenticated;

-- Admin-only list of staff requests.
DROP FUNCTION IF EXISTS public.get_staff_availability_requests();
CREATE FUNCTION public.get_staff_availability_requests()
RETURNS TABLE(
  id uuid, staff_id text, staff_name text, staff_email text, request_status text,
  start_date date, end_date date, reason text, approval_status text,
  admin_note text, reviewed_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.tidyline_is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  RETURN QUERY
  SELECT r.id,r.staff_id,s.name,s.email,r.status,r.start_date,r.end_date,r.reason,
         r.approval_status,r.admin_note,r.reviewed_at,r.created_at
  FROM public.staff_availability_requests r
  JOIN public.staff s ON s.id=r.staff_id
  ORDER BY CASE WHEN r.approval_status='pending' THEN 0 ELSE 1 END, r.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_staff_availability_requests() TO authenticated;

-- Approve/reject a request. Approval writes the official availability record.
DROP FUNCTION IF EXISTS public.review_staff_availability_request(uuid,text,text);
CREATE FUNCTION public.review_staff_availability_request(
  p_request_id uuid,
  p_decision text,
  p_admin_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.staff_availability_requests;
  v_staff public.staff;
BEGIN
  IF NOT public.tidyline_is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Decision must be approved or rejected'; END IF;

  SELECT * INTO r FROM public.staff_availability_requests WHERE id=p_request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Availability request not found'; END IF;
  IF r.approval_status <> 'pending' THEN RAISE EXCEPTION 'This request has already been reviewed'; END IF;

  SELECT * INTO v_staff FROM public.staff WHERE id=r.staff_id FOR UPDATE;

  UPDATE public.staff_availability_requests
  SET approval_status=p_decision, admin_note=NULLIF(trim(coalesce(p_admin_note,'')),''), reviewed_at=now()
  WHERE id=r.id;

  IF p_decision='approved' THEN
    -- Remove overlapping official records for this staff member before inserting the approved period.
    DELETE FROM public.staff_availability
    WHERE staff_id=r.staff_id AND start_date <= r.end_date AND end_date >= r.start_date;

    INSERT INTO public.staff_availability(staff_id,status,start_date,end_date,reason)
    VALUES(r.staff_id,r.status,r.start_date,r.end_date,r.reason);

    IF current_date BETWEEN r.start_date AND r.end_date THEN
      UPDATE public.staff SET current_status=r.status WHERE id=r.staff_id;
    END IF;
  END IF;

  INSERT INTO public.activity_log(message)
  VALUES(v_staff.name || ' availability request ' || p_decision || ' by Admin');
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.review_staff_availability_request(uuid,text,text) TO authenticated;

-- Ensure Staff Portal requests cannot be changed directly by arbitrary clients.
ALTER TABLE public.staff_availability_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_requests_admin_all ON public.staff_availability_requests;
DROP POLICY IF EXISTS staff_requests_staff_read ON public.staff_availability_requests;
CREATE POLICY staff_requests_staff_read ON public.staff_availability_requests
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.staff s WHERE s.id=staff_availability_requests.staff_id AND s.auth_user_id=auth.uid()));

-- Only the RPC should insert/update requests. Existing app users should not be
-- able to modify them directly.
DROP POLICY IF EXISTS staff_requests_staff_insert ON public.staff_availability_requests;
DROP POLICY IF EXISTS staff_requests_authenticated_insert ON public.staff_availability_requests;

-- Settings: prevent linked staff accounts from changing business configuration directly.
DROP POLICY IF EXISTS settings_admin_all ON public.settings;
CREATE POLICY settings_admin_all ON public.settings
FOR ALL TO authenticated
USING (public.tidyline_is_admin())
WITH CHECK (public.tidyline_is_admin());

CREATE INDEX IF NOT EXISTS staff_availability_requests_status_idx
ON public.staff_availability_requests(approval_status,created_at DESC);

-- Keep the staff portal status accurate after a temporary leave/sick/day-off period ends.
CREATE OR REPLACE FUNCTION public.get_my_staff_profile()
RETURNS SETOF public.staff
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff public.staff;
  v_status text;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE auth_user_id=auth.uid() AND active=true LIMIT 1;
  IF v_staff.id IS NULL THEN RETURN; END IF;

  SELECT sa.status INTO v_status
  FROM public.staff_availability sa
  WHERE sa.staff_id=v_staff.id
    AND sa.start_date <= current_date
    AND sa.end_date >= current_date
  ORDER BY sa.start_date DESC
  LIMIT 1;

  IF v_status IS NULL THEN v_status := 'available'; END IF;
  IF v_staff.current_status IS DISTINCT FROM v_status THEN
    UPDATE public.staff SET current_status=v_status WHERE id=v_staff.id;
    v_staff.current_status := v_status;
  END IF;

  RETURN NEXT v_staff;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_staff_profile() TO authenticated;
