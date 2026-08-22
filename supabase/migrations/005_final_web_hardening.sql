-- TIDYLINE FINAL WEB HARDENING MIGRATION
-- Run after 001_professional_upgrade.sql, 002_no_automatic_staff_assignment.sql,
-- 003_currency_and_email.sql and 004_staff_availability.sql.
--
-- This migration fixes the Settings null problem, stores the currency used
-- for each booking, and guarantees that public booking creation remains
-- pending/unassigned.

INSERT INTO settings (
  id, company_name, price_standard, price_deep, price_moveinout, price_office, currency
)
VALUES (1, 'Tidyline', 45, 65, 55, 50, 'USD')
ON CONFLICT (id) DO UPDATE SET
  company_name = COALESCE(NULLIF(settings.company_name,''), 'Tidyline'),
  price_standard = COALESCE(settings.price_standard,45),
  price_deep = COALESCE(settings.price_deep,65),
  price_moveinout = COALESCE(settings.price_moveinout,55),
  price_office = COALESCE(settings.price_office,50),
  currency = CASE WHEN settings.currency IN ('USD','GHS','EUR','GBP') THEN settings.currency ELSE 'USD' END;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_currency_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_currency_check
  CHECK (currency IN ('USD','GHS','EUR','GBP'));

-- Keep historical rows aligned with the current configured currency.
UPDATE bookings
SET currency = COALESCE(NULLIF(currency,''),(SELECT currency FROM settings WHERE id=1),'USD')
WHERE currency IS NULL OR currency = '';

-- Public booking RPC: price from settings, currency captured at booking time,
-- status always pending, staff always NULL.
DROP FUNCTION IF EXISTS create_booking(text,text,text,text,date,text,text,text,text);
DROP FUNCTION IF EXISTS create_booking(text,text,text,text,text,date,text,text,text,text);

CREATE OR REPLACE FUNCTION create_booking(
  p_id text,
  p_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_date date,
  p_start text,
  p_end text,
  p_type text,
  p_notes text
)
RETURNS TABLE(price numeric, booking_ref text, currency text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration numeric;
  v_rate numeric;
  v_price numeric;
  v_ref text;
  v_currency text;
BEGIN
  IF trim(coalesce(p_name,'')) = '' OR trim(coalesce(p_email,'')) = '' THEN
    RAISE EXCEPTION 'Name and email are required';
  END IF;

  IF trim(coalesce(p_address,'')) = '' THEN
    RAISE EXCEPTION 'Service address is required';
  END IF;

  IF p_date < current_date THEN
    RAISE EXCEPTION 'Service date cannot be in the past';
  END IF;

  v_duration := extract(epoch FROM (p_end::time - p_start::time)) / 3600.0;

  IF v_duration <= 0 THEN
    RAISE EXCEPTION 'End time must be after start time';
  END IF;

  IF v_duration > 12 THEN
    RAISE EXCEPTION 'Service duration is too long';
  END IF;

  SELECT
    CASE p_type
      WHEN 'Standard clean' THEN price_standard
      WHEN 'Deep clean' THEN price_deep
      WHEN 'Move-in / move-out' THEN price_moveinout
      WHEN 'Office clean' THEN price_office
      ELSE NULL
    END,
    CASE WHEN settings.currency IN ('USD','GHS','EUR','GBP') THEN settings.currency ELSE 'USD' END
  INTO v_rate, v_currency
  FROM settings
  WHERE id = 1;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'Tidyline settings are not initialized. Run the final web hardening migration.';
  END IF;

  v_price := round(v_rate * v_duration, 2);
  v_ref := 'TD-' || to_char(current_date,'YYYYMMDD') || '-' ||
           upper(substr(md5(p_id || clock_timestamp()::text),1,6));

  INSERT INTO bookings(
    id,name,phone,email,address,date,start_time,end_time,type,notes,
    status,staff_id,price,booking_ref,payment_status,currency
  )
  VALUES(
    p_id,p_name,p_phone,p_email,p_address,p_date,p_start,p_end,p_type,p_notes,
    'pending',NULL,v_price,v_ref,'unpaid',v_currency
  );

  INSERT INTO activity_log(message)
  VALUES('New booking ' || v_ref || ' from ' || p_name || ' — pending admin assignment.');

  RETURN QUERY SELECT v_price, v_ref, v_currency;
END;
$$;

REVOKE ALL ON FUNCTION create_booking(text,text,text,text,text,date,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_booking(text,text,text,text,text,date,text,text,text,text) TO anon, authenticated;

-- Stronger date validation for staff availability.
ALTER TABLE staff_availability DROP CONSTRAINT IF EXISTS staff_availability_date_order;
ALTER TABLE staff_availability ADD CONSTRAINT staff_availability_date_order
  CHECK (end_date >= start_date);

CREATE INDEX IF NOT EXISTS bookings_currency_idx ON bookings(currency);
CREATE INDEX IF NOT EXISTS staff_availability_staff_dates_idx
  ON staff_availability(staff_id,start_date,end_date);
