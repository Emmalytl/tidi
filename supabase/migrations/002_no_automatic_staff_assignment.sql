-- TIDYLINE: DISABLE AUTOMATIC STAFF ASSIGNMENT
-- Run this in Supabase SQL Editor.
-- New public bookings will always be created as PENDING and UNASSIGNED.
-- An administrator must assign a staff member from the Admin console.

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
RETURNS TABLE(
  price numeric,
  booking_ref text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration numeric;
  v_rate numeric := 0;
  v_price numeric := 0;
  v_ref text;
BEGIN
  IF trim(coalesce(p_name,'')) = '' OR trim(coalesce(p_email,'')) = '' THEN
    RAISE EXCEPTION 'Name and email are required';
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

  SELECT CASE p_type
    WHEN 'Standard clean' THEN price_standard
    WHEN 'Deep clean' THEN price_deep
    WHEN 'Move-in / move-out' THEN price_moveinout
    WHEN 'Office clean' THEN price_office
    ELSE NULL
  END
  INTO v_rate
  FROM settings
  WHERE id = 1;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'Invalid service type';
  END IF;

  v_price := round(v_rate * v_duration, 2);

  v_ref := 'TD-' || to_char(current_date,'YYYYMMDD') || '-' || upper(substr(md5(p_id || clock_timestamp()::text),1,6));

  INSERT INTO bookings(
    id,
    name,
    phone,
    email,
    address,
    date,
    start_time,
    end_time,
    type,
    notes,
    status,
    staff_id,
    price,
    booking_ref,
    payment_status
  )
  VALUES(
    p_id,
    p_name,
    p_phone,
    p_email,
    p_address,
    p_date,
    p_start,
    p_end,
    p_type,
    p_notes,
    'pending',
    NULL,
    v_price,
    v_ref,
    'unpaid'
  );

  INSERT INTO activity_log(message)
  VALUES('New booking ' || v_ref || ' from ' || p_name || ' — pending admin assignment.');

  RETURN QUERY SELECT v_price, v_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION create_booking(text,text,text,text,text,date,text,text,text,text) TO anon;
