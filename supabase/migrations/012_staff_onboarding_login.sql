-- Tidyline Staff Onboarding + Staff ID Login
-- Passwords are NEVER stored in public.staff. Supabase Auth stores password hashes.

ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS employee_id text;

-- Generate missing employee IDs for existing staff records.
DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.staff WHERE employee_id IS NULL OR trim(employee_id)='' ORDER BY id LOOP
    n := n + 1;
    UPDATE public.staff SET employee_id = 'TDL-' || lpad(n::text,4,'0') WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS staff_employee_id_unique_idx ON public.staff(employee_id) WHERE employee_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.next_staff_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=public
AS $$
DECLARE n integer;
BEGIN
  SELECT COALESCE(MAX((regexp_match(employee_id,'^TDL-([0-9]+)$'))[1]::integer),0)+1
  INTO n FROM public.staff;
  RETURN 'TDL-' || lpad(n::text,4,'0');
END;
$$;
GRANT EXECUTE ON FUNCTION public.next_staff_id() TO authenticated;

-- Maps the staff-facing ID to the email used internally by Supabase Auth.
-- The staff portal never asks the employee for their email.
CREATE OR REPLACE FUNCTION public.get_staff_login_email(p_staff_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public
AS $$
  SELECT email FROM public.staff
  WHERE upper(employee_id)=upper(trim(p_staff_id))
    AND active=true
    AND email IS NOT NULL
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_staff_login_email(text) TO authenticated;

-- Staff profiles remain readable by authenticated internal users; onboarding is performed by the Edge Function.
COMMENT ON COLUMN public.staff.employee_id IS 'Tidyline staff login ID, e.g. TDL-0001. Generated automatically.';
COMMENT ON COLUMN public.staff.address IS 'Employee residential/contact address.';
