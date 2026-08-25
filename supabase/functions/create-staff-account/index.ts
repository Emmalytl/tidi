import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Authentication required.');

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) throw new Error('Your Admin session has expired. Please sign in again.');

    const admin = createClient(url, serviceKey);
    // Existing Tidyline uses authenticated accounts for Admin. Staff accounts are linked
    // to public.staff; prevent a staff account from onboarding another employee.
    const { data: callerStaff } = await admin.from('staff').select('id').eq('auth_user_id', user.id).maybeSingle();
    if (callerStaff) throw new Error('Staff accounts cannot onboard other staff members.');

    const body = await req.json();
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim();
    const address = String(body.address || '').trim() || null;
    const password = String(body.password || '');
    if (!name || !email || !phone) throw new Error('Name, email and phone are required.');
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');

    const { data: idData, error: idError } = await admin.rpc('next_staff_id');
    if (idError) throw idError;
    const staffId = idData as string;

    const { data: existing } = await admin.from('staff').select('id').or(`email.eq.${email},employee_id.eq.${staffId}`).maybeSingle();
    if (existing) throw new Error('A staff member with this email or Staff ID already exists.');

    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'staff', staff_id: staffId, name },
    });
    if (authError) throw authError;

    const { data: staffRow, error: staffError } = await admin.from('staff').insert({
      id: `staff_${crypto.randomUUID()}`,
      employee_id: staffId,
      auth_user_id: created.user.id,
      name,
      email,
      phone,
      address,
      active: true,
      current_status: 'available',
    }).select().single();

    if (staffError) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw staffError;
    }

    return new Response(JSON.stringify({ success: true, staff_id: staffId, staff: staffRow }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
    });
  }
});
