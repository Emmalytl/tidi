# Tidyline Index — Final Update

The customer-facing index is now considered frozen after this release.

## Final additions

1. **Check Booking**
   - Customer enters booking code + booking email.
   - Public lookup returns only safe status information.
   - Shows booking status, assigned professional, service, schedule and total.

2. **Booking status tracking**
   - Pending → Assigned → In progress → Completed.
   - Public status timeline updates from the live booking record.

3. **Copy booking code**
   - One-click copy from confirmation and booking lookup.

4. **Invoice access**
   - View invoice in a responsive modal.
   - Print invoice.
   - Download a standalone HTML invoice that can be printed/saved as PDF.

5. **How it works**
   - Existing compact three-step section retained as part of the final design.

6. **WhatsApp support**
   - Floating WhatsApp button added.
   - Configure `settings.whatsapp_number` in Supabase using digits only, including country code (for example `23320XXXXXXX`).
   - If not configured, the button safely displays a configuration message instead of linking to a wrong number.

## Required Supabase migration

Run:

`supabase/migrations/007_public_booking_status_and_whatsapp.sql`

Copy the SQL inside the file into Supabase SQL Editor and run it.

Do not paste the filename itself into the SQL editor.

## Customer privacy

The public booking lookup requires both the booking reference and the email used at booking time. It intentionally does not expose the customer's address or phone number.

## Index freeze

After this release, the customer index should be treated as frozen. Future work should focus on Admin and Staff Portal functionality.
