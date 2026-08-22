const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const currency = (code: string) => ({
  USD: '$', GHS: 'GH₵', EUR: '€', GBP: '£'
} as Record<string,string>)[code] || '$';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));

const layout = (title: string, body: string) => `<!doctype html><html><body style="margin:0;background:#f4f8fb;font-family:Arial,sans-serif;color:#14213d"><div style="max-width:680px;margin:30px auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e5edf4"><div style="padding:28px 32px;background:#0d2340;color:#fff"><div style="font-size:28px;font-weight:800">Tidyline</div><div style="opacity:.75;font-size:12px;letter-spacing:2px;margin-top:4px">CLEAN SPACES · BETTER LIVES</div></div><div style="padding:32px"><h1 style="margin-top:0">${esc(title)}</h1>${body}</div><div style="padding:20px 32px;background:#f7fafc;color:#667085;font-size:12px">This is an automated message from Tidyline.</div></div></body></html>`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { type, booking, companyName = 'Tidyline' } = await req.json();
    const apiKey = Deno.env.get('RESEND_API_KEY');
    const from = Deno.env.get('EMAIL_FROM') || 'Tidyline <onboarding@resend.dev>';
    if (!apiKey) throw new Error('RESEND_API_KEY is not configured in Supabase secrets.');

    const symbol = currency(booking.currency || 'USD');
    const price = `${symbol}${Number(booking.price || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const ref = esc(booking.booking_ref || booking.id);
    const details = `<div style="background:#f7fafc;border-radius:12px;padding:18px;margin:20px 0"><p><b>Booking:</b> ${ref}</p><p><b>Service:</b> ${esc(booking.type)}</p><p><b>Date:</b> ${esc(booking.date)}</p><p><b>Time:</b> ${esc(booking.start_time)} – ${esc(booking.end_time)}</p><p><b>Address:</b> ${esc(booking.address)}</p><p><b>Total:</b> ${price}</p></div>`;

    let subject = 'Tidyline booking received';
    let title = 'Your booking request is received';
    let body = `<p>Hi ${esc(booking.name || 'there')},</p><p>Thank you for choosing Tidyline. Your booking request has been received and is currently <b>Pending admin assignment</b>.</p>${details}<p>We will notify you when a Tidyline professional has been assigned.</p>`;

    if (type === 'invoice') {
      subject = `Tidyline invoice — ${booking.booking_ref || booking.id}`;
      title = 'Your Tidyline invoice';
      body = `<p>Hi ${esc(booking.name || 'there')},</p><p>Please find your Tidyline invoice details below.</p>${details}<p><b>Payment status:</b> ${esc(booking.payment_status || 'unpaid').toUpperCase()}</p><p>Thank you for choosing Tidyline.</p>`;
    }

    if (type === 'assigned') {
      subject = `Tidyline booking assigned — ${booking.booking_ref || booking.id}`;
      title = 'Your Tidyline professional has been assigned';
      body = `<p>Hi ${esc(booking.name || 'there')},</p><p>Your booking has been assigned to <b>${esc(booking.staff_name || 'a Tidyline professional')}</b>.</p>${details}`;
    }

    let to: string[] = [];
    if (type === 'admin_booking') {
      const adminEmail = Deno.env.get('ADMIN_EMAIL');
      if (!adminEmail) throw new Error('ADMIN_EMAIL is not configured in Supabase secrets.');
      to = [adminEmail];
      subject = `Tidyline new booking — ${booking.booking_ref || booking.id}`;
      title = 'New booking requires assignment';
      body = `<p>A new booking has been submitted and is waiting for admin assignment.</p>${details}<p><b>Customer:</b> ${esc(booking.name || '')}<br><b>Email:</b> ${esc(booking.email || '')}<br><b>Phone:</b> ${esc(booking.phone || '')}</p><p><b>Status:</b> PENDING</p>`;
    } else {
      if (!booking?.email) throw new Error('Booking email is required.');
      to = [booking.email];
    }

    const payload = { from, to, subject, html: layout(title, body) };
    const response = await fetch('https://api.resend.com/emails', { method:'POST', headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.message || 'Email provider rejected the request.');

    return new Response(JSON.stringify({ ok:true, id:result.id, companyName }), { status:200, headers:{...corsHeaders,'Content-Type':'application/json'} });
  } catch (error) {
    return new Response(JSON.stringify({ ok:false, error:error instanceof Error ? error.message : 'Email failed' }), { status:500, headers:{...corsHeaders,'Content-Type':'application/json'} });
  }
});
