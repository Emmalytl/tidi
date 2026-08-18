-- TIDYLINE: currency configuration and notification support
-- Run after 002_no_automatic_staff_assignment.sql

ALTER TABLE settings ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_currency_check;
ALTER TABLE settings ADD CONSTRAINT settings_currency_check CHECK (currency IN ('USD','GHS','EUR','GBP'));

UPDATE settings SET currency = COALESCE(NULLIF(currency,''),'USD') WHERE id = 1;
