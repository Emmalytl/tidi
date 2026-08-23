-- TIDYLINE STAFF PORTAL
-- Run after the existing Tidyline migrations.
-- 1) Create each staff user's Auth account in Supabase Authentication > Users.
-- 2) Copy the Auth user's UUID into staff.auth_user_id for that employee.

ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS current_status text NOT NULL DEFAULT 'available';
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_current_status_check;
ALTER TABLE public.staff ADD CONSTRAINT staff_current_status_check CHECK (current_status IN ('available','unavailable','leave','sick','day_off','inactive'));
CREATE INDEX IF NOT EXISTS staff_auth_user_idx ON public.staff(auth_user_id);

CREATE TABLE IF NOT EXISTS public.staff_availability_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id text NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('available','unavailable','leave','sick','day_off')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  admin_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (length(trim(reason)) > 0)
);
CREATE INDEX IF NOT EXISTS staff_availability_requests_staff_idx ON public.staff_availability_requests(staff_id,created_at DESC);

-- Staff identity helper.
CREATE OR REPLACE FUNCTION public.get_my_staff_profile()
RETURNS SETOF public.staff
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT * FROM public.staff WHERE auth_user_id = auth.uid() AND active = true LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_staff_profile() TO authenticated;

-- Staff can only retrieve their own bookings through this RPC.
CREATE OR REPLACE FUNCTION public.get_my_staff_bookings()
RETURNS SETOF public.bookings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT b.* FROM public.bookings b
  JOIN public.staff s ON s.id=b.staff_id
  WHERE s.auth_user_id=auth.uid()
  ORDER BY b.date ASC, b.start_time ASC;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_staff_bookings() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_availability_requests()
RETURNS SETOF public.staff_availability_requests
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT r.* FROM public.staff_availability_requests r
  JOIN public.staff s ON s.id=r.staff_id
  WHERE s.auth_user_id=auth.uid()
  ORDER BY r.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_availability_requests() TO authenticated;

-- Start a job only if it is assigned to the signed-in staff member.
CREATE OR REPLACE FUNCTION public.start_my_job(p_booking_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ok boolean;
BEGIN
  UPDATE public.bookings b SET status='in_progress', started_at=now(), updated_at=now()
  WHERE b.id=p_booking_id AND b.status='assigned'
    AND EXISTS (SELECT 1 FROM public.staff s WHERE s.id=b.staff_id AND s.auth_user_id=auth.uid() AND s.active=true);
  ok := FOUND;
  IF ok THEN INSERT INTO public.activity_log(message) VALUES('Staff started booking '||p_booking_id); END IF;
  RETURN ok;
END; $$;
GRANT EXECUTE ON FUNCTION public.start_my_job(text) TO authenticated;

-- Complete a job only if it is in progress and assigned to the signed-in staff member.
CREATE OR REPLACE FUNCTION public.complete_my_job(p_booking_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ok boolean;
BEGIN
  UPDATE public.bookings b SET status='completed', completed_at=now(), end_time=to_char(now(),'HH24:MI'), updated_at=now()
  WHERE b.id=p_booking_id AND b.status='in_progress'
    AND EXISTS (SELECT 1 FROM public.staff s WHERE s.id=b.staff_id AND s.auth_user_id=auth.uid() AND s.active=true);
  ok := FOUND;
  IF ok THEN INSERT INTO public.activity_log(message) VALUES('Staff completed booking '||p_booking_id); END IF;
  RETURN ok;
END; $$;
GRANT EXECUTE ON FUNCTION public.complete_my_job(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_staff_availability_request(
  p_status text,p_start_date date,p_end_date date,p_reason text
)
RETURNS public.staff_availability_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_staff public.staff; v_request public.staff_availability_requests;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE auth_user_id=auth.uid() AND active=true LIMIT 1;
  IF v_staff.id IS NULL THEN RAISE EXCEPTION 'Staff profile not linked to this account'; END IF;
  IF p_end_date < p_start_date THEN RAISE EXCEPTION 'End date must be on or after start date'; END IF;
  IF trim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  INSERT INTO public.staff_availability_requests(staff_id,status,start_date,end_date,reason)
  VALUES(v_staff.id,p_status,p_start_date,p_end_date,trim(p_reason)) RETURNING * INTO v_request;
  INSERT INTO public.activity_log(message) VALUES(v_staff.name||' submitted an availability request');
  RETURN v_request;
END; $$;
GRANT EXECUTE ON FUNCTION public.submit_staff_availability_request(text,date,date,text) TO authenticated;

-- Keep legacy direct staff_availability table usable by Admin. Staff requests are
-- separate so Admin approval remains authoritative.
ALTER TABLE public.staff_availability_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_requests_admin_all ON public.staff_availability_requests;
CREATE POLICY staff_requests_admin_all ON public.staff_availability_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Add timing columns if they do not already exist.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS completed_at timestamptz;
