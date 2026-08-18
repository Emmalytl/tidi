# Tidyline Email Setup

The project includes a Supabase Edge Function at `supabase/functions/send-email/index.ts` using Resend.

## 1. Create a Resend account
Create an account at https://resend.com and verify the sending domain you intend to use.

## 2. Configure Supabase secrets
Set these secrets for the Edge Function:

- `RESEND_API_KEY` — your Resend API key
- `EMAIL_FROM` — for example `Tidyline <bookings@yourdomain.com>`

Do not put the API key in `config.js` or browser JavaScript.

## 3. Deploy
From the project root:

`supabase functions deploy send-email`

## 4. Test
Create a booking. The customer should receive a booking confirmation email. From Admin > Bookings, use Invoice to send an invoice email.

If email fails, the booking remains saved; the UI reports that the email could not be sent.
