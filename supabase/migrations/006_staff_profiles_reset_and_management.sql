-- TIDYLINE: STAFF PROFILES, PAYROLL METRICS, DELETE/RESET CONTROLS
-- Run after 005_final_web_hardening.sql.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS employee_id text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS hire_date date;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS pay_type text NOT NULL DEFAULT 'hourly';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS hourly_rate numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS base_salary numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS other_deductions numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS emergency_contact_name text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS emergency_contact_phone text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_pay_type_check;
ALTER TABLE staff ADD CONSTRAINT staff_pay_type_check CHECK (pay_type IN ('hourly','monthly'));
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_tax_rate_check;
ALTER TABLE staff ADD CONSTRAINT staff_tax_rate_check CHECK (tax_rate >= 0 AND tax_rate <= 100);
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_hourly_rate_check;
ALTER TABLE staff ADD CONSTRAINT staff_hourly_rate_check CHECK (hourly_rate >= 0);
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_base_salary_check;
ALTER TABLE staff ADD CONSTRAINT staff_base_salary_check CHECK (base_salary >= 0);
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_other_deductions_check;
ALTER TABLE staff ADD CONSTRAINT staff_other_deductions_check CHECK (other_deductions >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS staff_employee_id_idx ON staff(employee_id) WHERE employee_id IS NOT NULL AND employee_id <> '';

-- Prevent overlapping availability records for the same person/date range from
-- creating a locked state. The Admin application replaces overlapping records.
CREATE INDEX IF NOT EXISTS staff_availability_lookup_idx ON staff_availability(staff_id,start_date,end_date);

-- Delete one booking from the Admin console.
DROP FUNCTION IF EXISTS delete_booking(text);
REVOKE ALL ON FUNCTION delete_booking(text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION delete_booking(p_booking_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  DELETE FROM bookings WHERE id=p_booking_id;
  RETURN FOUND;
END; $$;
GRANT EXECUTE ON FUNCTION delete_booking(text) TO authenticated;

-- Clear all audit history.
DROP FUNCTION IF EXISTS clear_audit_history();
CREATE OR REPLACE FUNCTION clear_audit_history()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  DELETE FROM activity_log;
  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION clear_audit_history() TO authenticated;

-- One explicit, protected fresh-start operation. The Admin must provide the
-- exact phrase. This clears operational/business data but does not delete the
-- authenticated administrator account itself.
DROP FUNCTION IF EXISTS reset_tidyline_system(text);
CREATE OR REPLACE FUNCTION reset_tidyline_system(p_confirmation text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_confirmation <> 'RESET TIDYLINE' THEN
    RAISE EXCEPTION 'Invalid reset confirmation';
  END IF;

  DELETE FROM staff_availability;
  DELETE FROM bookings;
  DELETE FROM activity_log;
  DELETE FROM staff;

  UPDATE settings SET
    company_name='Tidyline',
    price_standard=45,
    price_deep=65,
    price_moveinout=55,
    price_office=50,
    currency='USD',
    updated_at=now()
  WHERE id=1;

  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION reset_tidyline_system(text) TO authenticated;
