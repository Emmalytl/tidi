import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey);
    const { staff_id, password } = await req.json();
    const id = String(staff_id || '').trim().toUpperCase();
    const pass = String(password || '');
    if (!id || !pass) throw new Error('Staff ID and password are required.');

    const { data: staff, error: staffError } = await admin.from('staff')
      .select('email,active')
      .eq('employee_id', id)
      .maybeSingle();
    if (staffError || !staff || !staff.active || !staff.email) throw new Error('Invalid Staff ID or password.');

    const authClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data, error } = await authClient.auth.signInWithPassword({ email: staff.email, password: pass });
    if (error || !data.session) throw new Error('Invalid Staff ID or password.');

    return new Response(JSON.stringify({
      success: true,
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
    });
  }
});
