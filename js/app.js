'use strict';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Admin sessions are intentionally scoped to admin.html. If an authenticated admin lands on the public site, sign out immediately.
(async()=>{try{const {data}=await sb.auth.getSession();if(data.session && sessionStorage.getItem('tidyline_admin_active')==='1'){sessionStorage.removeItem('tidyline_admin_active');await sb.auth.signOut();}}catch(e){console.warn('Admin session guard:',e)}})();
let settingsState={company_name:'Tidyline',logo_url:null,price_standard:45,price_deep:65,price_moveinout:55,price_office:50,currency:'USD'};
const CURRENCIES={USD:{symbol:'$',name:'US Dollar'},GHS:{symbol:'GH₵',name:'Ghana Cedi'},EUR:{symbol:'€',name:'Euro'},GBP:{symbol:'£',name:'British Pound'}};
function money(v){const c=CURRENCIES[settingsState.currency]||CURRENCIES.USD;return `${c.symbol}${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;}
const $=id=>document.getElementById(id);
const esc=s=>{const d=document.createElement('div');d.textContent=s??'';return d.innerHTML};
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),3200)}
function fmtDate(v){return new Date(v+'T00:00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'})}
function fmtTime(v){if(!v)return '';const [h,m]=v.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`}
function durationHours(a,b){if(!a||!b)return 0;let [ah,am]=a.split(':').map(Number),[bh,bm]=b.split(':').map(Number);let n=(bh*60+bm)-(ah*60+am);return n<0?n+1440:n? n/60:0}
function applyBranding(){const n='Tidyline';$('brandName').textContent=n;$('footerBrand').textContent=n;$('footerBrandSmall').textContent=n;document.title=`${n} — Professional cleaning, simply booked`;[['rate_standard',settingsState.price_standard],['rate_deep',settingsState.price_deep],['rate_moveinout',settingsState.price_moveinout],['rate_office',settingsState.price_office]].forEach(([id,v])=>$(id).textContent=`${(CURRENCIES[settingsState.currency]||CURRENCIES.USD).symbol}${Number(v||0).toFixed(0)}/hr`)}
async function loadSettings(){
  try{
    const {data,error}=await sb.from('settings').select('*').eq('id',1).maybeSingle();
    if(error) console.warn('Settings could not be loaded; using safe defaults:', error.message);
    if(data) settingsState={...settingsState,...data};
  }catch(e){ console.warn('Settings load failed; using safe defaults:',e); }
  applyBranding();
}
function updateEstimate(){
  const start=$('f_start')?.value||'',end=$('f_end')?.value||'',type=$('f_type')?.value||'Standard clean';
  const hrs=durationHours(start,end);
  const rate={"Standard clean":settingsState.price_standard,"Deep clean":settingsState.price_deep,"Move-in / move-out":settingsState.price_moveinout,"Office clean":settingsState.price_office}[type]||0;
  if(hrs){if($('durationPreview')) $('durationPreview').textContent=`${hrs.toFixed(1)} hour${hrs===1?'':'s'} × ${money(rate)}/hr`;if($('pricePreview')) $('pricePreview').textContent=money(hrs*Number(rate))}
  else {if($('durationPreview')) $('durationPreview').textContent='Select a time window';if($('pricePreview')) $('pricePreview').textContent='—'}
}
async function sendBookingEmail(booking){
  try{
    const {data,error}=await sb.functions.invoke('send-email',{body:{type:'booking_confirmation',booking,currency:settingsState.currency||'USD',companyName:'Tidyline'}});
    if(error) throw error;
    return data?.ok !== false;
  }catch(e){ console.error('Booking email:',e); return false; }
}

async function sendAdminBookingEmail(booking){
  try{
    await sb.functions.invoke('send-email',{body:{type:'admin_booking',booking,currency:settingsState.currency||'USD',companyName:'Tidyline'}});
  }catch(e){ console.warn('Admin notification email failed:',e); }
}

function initBookingForm(){
  const form=$('bookingForm');
  if(!form) return;
  const update=()=>updateEstimate();
  form.addEventListener('input',update);
  form.addEventListener('change',update);
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const start=$('f_start')?.value,end=$('f_end')?.value,date=$('f_date')?.value;
    if(!start||!end||start>=end){toast('Please choose a valid start and end time.');return}
    if(!date||date<new Date().toISOString().slice(0,10)){toast('Please choose a future service date.');return}
    const email=$('f_email')?.value.trim()||'';
    if(!/^\S+@\S+\.\S+$/.test(email)){toast('Please enter a valid email address.');return}
    const name=$('f_name')?.value.trim()||'';
    const address=$('f_address')?.value.trim()||'';
    if(!name||!address){toast('Please complete your name and service address.');return}
    const btn=$('submitBtn'); if(btn){btn.disabled=true;btn.innerHTML='Processing booking…'}
    const id='b_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
    const draft={id,name,phone:$('f_phone')?.value.trim()||'',email,address,date,start,end,type:$('f_type')?.value||'Standard clean',notes:$('f_notes')?.value.trim()||''};
    try{
      const {data,error}=await sb.rpc('create_booking',{p_id:id,p_name:draft.name,p_phone:draft.phone,p_email:draft.email,p_address:draft.address,p_date:draft.date,p_start:start,p_end:end,p_type:draft.type,p_notes:draft.notes});
      if(error) throw error;
      const r=Array.isArray(data)?data[0]:data;
      if(!r) throw new Error('No booking result returned. Please check the database function.');
      const bookingRef=r.booking_ref||r.assigned_booking_ref||id;
      const card=$('bookingCard'), confirm=$('confirmCard');
      if(card) card.hidden=true;
      if(confirm) confirm.hidden=false;
      if($('confirmTitle')) $('confirmTitle').textContent='Thank you for booking.';
      if($('confirmDetail')) $('confirmDetail').textContent=`${draft.type} on ${fmtDate(draft.date)} from ${fmtTime(start)} to ${fmtTime(end)} at ${draft.address}.`;
      if($('confirmRef')) $('confirmRef').textContent=bookingRef;
      if($('confirmInvoice')) $('confirmInvoice').textContent=`INV-${bookingRef}`;
      if($('confirmStaff')) $('confirmStaff').textContent='Pending admin assignment';
      if($('confirmPrice')) $('confirmPrice').textContent=money(r.price);
      const bookingPayload={...draft, start_time:start,end_time:end,price:r.price,booking_ref:bookingRef,status:'pending',currency:r.currency||settingsState.currency||'USD'};
      const sent=await sendBookingEmail(bookingPayload);
      void sendAdminBookingEmail(bookingPayload);
      if($('confirmEmailStatus')){
        $('confirmEmailStatus').textContent=sent?'✓ Confirmation email sent successfully.':'Your booking is saved. We could not send the confirmation email right now.';
        $('confirmEmailStatus').classList.toggle('email-failed',!sent);
      } else if(!sent) toast('Booking confirmed, but the email could not be sent.');
      if(confirm) confirm.scrollIntoView({behavior:'smooth',block:'center'});
    }catch(err){console.error(err);toast(err.message||'We could not create your booking. Please try again.')}
    finally{if(btn){btn.disabled=false;btn.innerHTML='Confirm booking request <span>→</span>'}}
  });
}

// Public-site interactions: scroll reveals, animated proof counters and service-card shortcuts.
function initHomeInteractions(){
  const revealObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');revealObserver.unobserve(e.target)}}),{threshold:.12});
  document.querySelectorAll('.reveal').forEach(el=>revealObserver.observe(el));
  const counterObserver=new IntersectionObserver(entries=>entries.forEach(e=>{if(!e.isIntersecting)return;const el=e.target,target=Number(el.dataset.target||0);let start=0,step=Math.max(1,Math.ceil(target/24));const tick=()=>{start=Math.min(target,start+step);el.textContent=start;if(start<target)requestAnimationFrame(tick)};tick();counterObserver.unobserve(el)}),{threshold:.7});
  document.querySelectorAll('.count').forEach(el=>counterObserver.observe(el));
  document.querySelectorAll('.service-card').forEach(card=>card.addEventListener('click',e=>{if(e.target.closest('a'))return;const type=card.dataset.service;if($('f_type')){$('f_type').value=type;updateEstimate();$('book').scrollIntoView({behavior:'smooth'})}}));
  document.querySelectorAll('[data-quick-service]').forEach(link=>link.addEventListener('click',()=>{const type=link.dataset.quickService;if($('f_type')){$('f_type').value=type;updateEstimate()}}));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initHomeInteractions);else initHomeInteractions();

function resetBooking(){
  // A fresh booking starts from a clean page so all booking fields and confirmation state are reset.
  window.location.reload();
}
window.resetBooking=resetBooking;

function bootPublicSite(){
  if($('year')) $('year').textContent=new Date().getFullYear();
  if($('f_date')) $('f_date').min=new Date().toISOString().slice(0,10);
  initBookingForm();
  loadSettings().then(()=>updateEstimate());
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bootPublicSite); else bootPublicSite;
