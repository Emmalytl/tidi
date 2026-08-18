'use strict';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const esc = value => { const d = document.createElement('div'); d.textContent = value ?? ''; return d.innerHTML; };

let staff = [];
let bookings = [];
let logs = [];
let settings = { price_standard:45, price_deep:65, price_moveinout:55, price_office:50, currency:'USD' };
const CURRENCIES = { USD:{code:'USD',symbol:'$',name:'US Dollar'}, GHS:{code:'GHS',symbol:'GH₵',name:'Ghana Cedi'}, EUR:{code:'EUR',symbol:'€',name:'Euro'}, GBP:{code:'GBP',symbol:'£',name:'British Pound'} };
function currencyInfo(){ return CURRENCIES[settings.currency] || CURRENCIES.USD; }
function money(value){ const c=currencyInfo(); return `${c.symbol}${Number(value||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
let adminSessionActive = false;
let inactivityTimer = null;
let warningTimer = null;
let countdownTimer = null;
let lastActivity = Date.now();
let activityBound = false;

const INACTIVITY_MS = 5 * 60 * 1000;
const WARNING_MS = 30 * 1000;

function toast(message){
  const el = $('toast');
  if(!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(window.__tidyToast);
  window.__tidyToast = setTimeout(() => el.classList.remove('show'), 3000);
}

function fmtDate(value){
  if(!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}

function fmtTime(value){
  if(!value) return '';
  const [h,m] = value.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function durationHours(start,end){
  if(!start || !end) return 0;
  const [ah,am] = start.split(':').map(Number);
  const [bh,bm] = end.split(':').map(Number);
  let minutes = (bh*60+bm) - (ah*60+am);
  if(minutes < 0) minutes += 1440;
  return minutes / 60;
}

function weekStart(date){
  const d = new Date(`${date}T00:00:00`);
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  return d.toISOString().slice(0,10);
}

function weekEnd(date){
  const d = new Date(`${weekStart(date)}T00:00:00`);
  d.setDate(d.getDate()+7);
  return d.toISOString().slice(0,10);
}

function staffHours(staffId,date){
  const start = weekStart(date);
  const end = weekEnd(date);
  return bookings.filter(b => b.staff_id === staffId && b.status !== 'cancelled' && b.date >= start && b.date < end)
    .reduce((sum,b) => sum + durationHours(b.start_time,b.end_time),0);
}

function updateSessionStatus(text='● Active',warning=false){
  const el = $('sessionStatus');
  if(!el) return;
  el.textContent = text;
  el.classList.toggle('warning',warning);
}

function hideLogoutWarning(){
  if($('logoutWarning')) $('logoutWarning').hidden = true;
  clearInterval(countdownTimer);
  countdownTimer = null;
}

function showLogoutWarning(){
  const warning = $('logoutWarning');
  if(!warning) return;
  warning.hidden = false;
  let seconds = 30;
  $('logoutCountdown').textContent = seconds;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    seconds -= 1;
    $('logoutCountdown').textContent = Math.max(seconds,0);
    if(seconds <= 0) clearInterval(countdownTimer);
  },1000);
  updateSessionStatus('● Expiring soon',true);
}

function stopInactivityWatch(){
  clearTimeout(inactivityTimer);
  clearTimeout(warningTimer);
  clearInterval(countdownTimer);
  inactivityTimer = warningTimer = countdownTimer = null;
  hideLogoutWarning();
}

function scheduleInactivityLogout(){
  clearTimeout(inactivityTimer);
  clearTimeout(warningTimer);
  clearInterval(countdownTimer);
  lastActivity = Date.now();

  warningTimer = setTimeout(showLogoutWarning, INACTIVITY_MS - WARNING_MS);
  inactivityTimer = setTimeout(() => automaticLogout(), INACTIVITY_MS);
}

function registerActivity(){
  if(!adminSessionActive) return;
  lastActivity = Date.now();
  hideLogoutWarning();
  updateSessionStatus();
  scheduleInactivityLogout();
}

function startInactivityWatch(){
  if(!activityBound){
    ['pointerdown','pointermove','keydown','scroll','touchstart','wheel'].forEach(event => {
      window.addEventListener(event,registerActivity,{passive:true});
    });
    document.addEventListener('visibilitychange',() => {
      if(document.hidden || !adminSessionActive) return;
      if(Date.now() - lastActivity >= INACTIVITY_MS) automaticLogout();
      else registerActivity();
    });
    activityBound = true;
  }
  scheduleInactivityLogout();
}

async function automaticLogout(){
  if(!adminSessionActive) return;
  adminSessionActive = false;
  stopInactivityWatch();
  sessionStorage.removeItem('tidyline_admin_active');
  try { await sb.auth.signOut(); } catch(e) { console.warn(e); }
  location.replace('admin.html');
}

async function logoutAdmin(){
  adminSessionActive = false;
  stopInactivityWatch();
  sessionStorage.removeItem('tidyline_admin_active');
  try { await sb.auth.signOut(); } finally { location.replace('admin.html'); }
}

async function leaveAdminArea(event){
  event.preventDefault();
  adminSessionActive = false;
  stopInactivityWatch();
  sessionStorage.removeItem('tidyline_admin_active');
  try { await sb.auth.signOut(); } finally { location.href = 'index.html'; }
}

function applyFixedBrand(){
  // Tidyline is intentionally hard-coded here. No database logo/company value can replace it.
  document.title = 'Tidyline — Admin';
  $('adminIdentity').textContent = 'Administrator';
}

async function loadSettings(){
  const {data,error} = await sb.from('settings').select('price_standard,price_deep,price_moveinout,price_office,currency').eq('id',1).single();
  if(!error && data) settings = {...settings,...data};
  applyFixedBrand();
}

async function loadData(){
  const [staffRes,bookingRes,logRes] = await Promise.all([
    sb.from('staff').select('*').order('created_at',{ascending:true}),
    sb.from('bookings').select('*').order('date',{ascending:false}).order('start_time',{ascending:true}),
    sb.from('activity_log').select('*').order('created_at',{ascending:false}).limit(100)
  ]);
  if(staffRes.error || bookingRes.error || logRes.error) toast('Some dashboard data could not be loaded.');
  staff = staffRes.data || [];
  bookings = bookingRes.data || [];
  logs = logRes.data || [];
  renderAll();
}

function renderAll(){
  renderStats();
  renderBookings();
  renderStaff();
  renderOverview();
  renderAudit();
  updatePendingBadge();
}

function renderStats(){
  const today = new Date().toISOString().slice(0,10);
  const upcoming = bookings.filter(b => b.date >= today && b.status !== 'cancelled').length;
  const pending = bookings.filter(b => b.status === 'pending').length;
  const assigned = bookings.filter(b => b.status === 'assigned').length;
  const completed = bookings.filter(b => b.status === 'completed').length;
  const revenue = bookings.filter(b => b.status !== 'cancelled').reduce((sum,b) => sum + Number(b.price || 0),0);
  const stats = [
    ['Total bookings',bookings.length,'All requests'],
    ['Pending',pending,'Awaiting dispatch'],
    ['Assigned',assigned,'Staff allocated'],
    ['Completed',completed,'Jobs completed'],
    ['Revenue',money(revenue),'Current recorded total']
  ];
  $('stats').innerHTML = stats.map(([label,value,meta]) => `<article class="stat-card"><small>${label}</small><strong>${value}</strong><span class="stat-meta">${meta}</span></article>`).join('');
}

function updatePendingBadge(){
  const pending = bookings.filter(b => b.status === 'pending').length;
  $('pendingBadge').textContent = pending;
  $('pendingCount').textContent = pending;
}

function renderOverview(){
  const pending = bookings.filter(b => b.status === 'pending').sort((a,b) => `${a.date}${a.start_time}`.localeCompare(`${b.date}${b.start_time}`)).slice(0,5);
  $('pendingPreview').innerHTML = pending.length ? pending.map(b => `<div class="pending-item"><div><strong>${esc(b.booking_ref || b.id)}</strong><small>${esc(b.name)} · ${fmtDate(b.date)} · ${fmtTime(b.start_time)}</small></div><button class="assign-now" data-view="bookings" type="button">Assign</button></div>`).join('') : `<div class="empty-state"><strong>You're all caught up.</strong><small>No pending booking requests need assignment.</small></div>`;
  $('pendingPreview').querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click',() => switchView('bookings')));

  const today = new Date().toISOString().slice(0,10);
  const active = staff.filter(s => s.active).slice(0,5);
  $('capacityPreview').innerHTML = active.length ? active.map(s => {
    const hours = staffHours(s.id,today);
    const pct = Math.min(hours/40*100,100);
    const initials = s.name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
    return `<div class="capacity-row"><div class="mini-avatar">${esc(initials)}</div><div><strong>${esc(s.name)}</strong><small>${hours.toFixed(1)}h this week</small><div class="mini-bar"><span style="width:${pct}%"></span></div></div><span class="capacity-hours">${hours.toFixed(1)}h</span></div>`;
  }).join('') : `<div class="empty-state"><strong>No active staff</strong><small>Add staff before dispatching requests.</small></div>`;
}

function renderBookings(){
  const query = ($('searchBookings').value || '').trim().toLowerCase();
  const filter = $('statusFilter').value;
  const rows = bookings.filter(b => {
    const statusMatch = filter === 'all' || b.status === filter;
    const searchable = `${b.booking_ref || ''} ${b.id || ''} ${b.name || ''} ${b.email || ''} ${b.phone || ''} ${b.address || ''} ${b.type || ''}`.toLowerCase();
    return statusMatch && (!query || searchable.includes(query));
  }).sort((a,b) => `${a.date}${a.start_time || ''}`.localeCompare(`${b.date}${b.start_time || ''}`));

  $('bookingRows').innerHTML = rows.length ? rows.map(renderBookingRow).join('') : `<tr><td colspan="9"><div class="empty-state"><strong>No bookings found</strong><small>Try a different search or status filter.</small></div></td></tr>`;
  document.querySelectorAll('.staff-select').forEach(select => select.addEventListener('change',() => assignBooking(select.dataset.id,select.value)));
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click',() => bookingAction(button.dataset.action,button.dataset.id)));
}

function renderBookingRow(b){
  const options = `<option value="">Keep pending / unassigned</option>` + staff.filter(s=>s.active).map(s => `<option value="${esc(s.id)}" ${s.id === b.staff_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  return `<tr>
    <td><strong>${esc(b.booking_ref || b.id)}</strong><small>${esc((b.created_at || '').slice(0,10))}</small></td>
    <td><strong>${esc(b.name)}</strong><small>${esc(b.email || '')}</small></td>
    <td><strong>${fmtDate(b.date)}</strong><small>${fmtTime(b.start_time)} – ${fmtTime(b.end_time)}</small></td>
    <td>${esc(b.type || '')}</td>
    <td class="address-cell" title="${esc(b.address || '')}">${esc(b.address || 'No address provided')}</td>
    <td><select class="staff-select" data-id="${esc(b.id)}" aria-label="Assign staff to ${esc(b.booking_ref || b.id)}">${options}</select></td>
    <td><span class="status status-${esc(b.status)}">${esc(b.status)}</span></td>
    <td><strong>${money(b.price)}</strong><small>${esc(settings.currency || 'USD')}</small></td>
    <td><div class="action-row">
      ${b.status !== 'completed' && b.status !== 'cancelled' ? `<button data-action="complete" data-id="${esc(b.id)}">Complete</button>` : ''}
      ${b.status !== 'cancelled' ? `<button data-action="cancel" data-id="${esc(b.id)}">Cancel</button>` : ''}
      <button data-action="invoice" data-id="${esc(b.id)}">Invoice</button><button data-action="print" data-id="${esc(b.id)}">Print</button>
    </div></td>
  </tr>`;
}

function renderStaff(){
  const today = new Date().toISOString().slice(0,10);
  $('staffList').innerHTML = staff.length ? staff.map(s => {
    const hours = staffHours(s.id,today);
    const pct = Math.min(hours/40*100,100);
    const initials = s.name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
    const label = hours >= 40 ? 'At capacity' : hours >= 30 ? 'Busy' : hours >= 20 ? 'On target' : 'Available';
    return `<article class="staff-card"><div class="staff-card-top"><div class="mini-avatar">${esc(initials)}</div><div><strong>${esc(s.name)}</strong><small>${s.active ? 'Active professional' : 'Inactive'}</small></div></div><div class="capacity-label">${label} · ${hours.toFixed(1)}h / 40h</div><div class="mini-bar"><span style="width:${pct}%"></span></div></article>`;
  }).join('') : `<div class="empty-state"><strong>No staff members</strong><small>Add your first professional.</small></div>`;
}

function renderAudit(){
  $('activityList').innerHTML = logs.length ? logs.map(log => `<article class="audit-item"><strong>${esc(log.message || 'System activity')}</strong><small>${new Date(log.created_at).toLocaleString()}</small></article>`).join('') : `<div class="empty-state"><strong>No audit activity</strong><small>Administrative events will appear here.</small></div>`;
}

async function writeAudit(message){
  const {error} = await sb.from('activity_log').insert({message});
  if(error) console.warn('Audit log failed:',error.message);
}

async function assignBooking(bookingId,staffId){
  const booking = bookings.find(b => b.id === bookingId);
  if(!booking) return;

  if(!staffId){
    const {error} = await sb.from('bookings').update({staff_id:null,status:'pending'}).eq('id',bookingId);
    if(error){toast(error.message);return;}
    await writeAudit(`Booking ${booking.booking_ref || bookingId} returned to pending queue.`);
    toast('Booking is now pending and unassigned.');
    await loadData();
    return;
  }

  const member = staff.find(s => s.id === staffId);
  const {error} = await sb.from('bookings').update({staff_id:staffId,status:'assigned'}).eq('id',bookingId);
  if(error){toast(error.message);return;}
  await writeAudit(`Booking ${booking.booking_ref || bookingId} assigned to ${member?.name || 'staff member'}.`);
  toast(`Assigned to ${member?.name || 'staff member'}.`);
  await loadData();
}

async function bookingAction(type,id){
  const booking = bookings.find(b => b.id === id);
  if(!booking) return;
  if(type === 'invoice') return sendInvoice(booking);
  if(type === 'print') return printInvoice(booking);
  if(type === 'complete' && !booking.staff_id){ toast('Assign a staff member before completing this booking.'); return; }
  const status = type === 'complete' ? 'completed' : 'cancelled';
  const {error} = await sb.from('bookings').update({status}).eq('id',id);
  if(error){toast(error.message);return;}
  await writeAudit(`Booking ${booking.booking_ref || id} marked ${status}.`);
  toast(`Booking marked ${status}.`);
  await loadData();
}

async function sendInvoice(booking){
  try{
    const {error} = await sb.functions.invoke('send-email',{body:{type:'invoice',booking:{email:booking.email,type:booking.type,date:booking.date,start_time:booking.start_time,end_time:booking.end_time,address:booking.address,price:booking.price,booking_ref:booking.booking_ref,currency:settings.currency || 'USD'},companyName:'Tidyline',logoUrl:null}});
    if(error) throw error;
    toast('Invoice email sent.');
    await writeAudit(`Invoice sent for booking ${booking.booking_ref || booking.id}.`);
  }catch(error){ console.error(error); toast('Could not send invoice email.'); }
}

function printInvoice(booking){
  const c=currencyInfo();
  const total=money(booking.price);
  const win=window.open('', '_blank', 'noopener,noreferrer,width=850,height=900');
  if(!win){toast('Please allow pop-ups to print the invoice.');return;}
  win.document.write(`<!doctype html><html><head><title>Invoice ${esc(booking.booking_ref||booking.id)}</title><style>body{font-family:Arial,sans-serif;color:#14213d;padding:48px;max-width:760px;margin:auto}h1{margin:0 0 4px;font-size:30px}h2{margin-top:40px}.muted{color:#667085}.row{display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid #e5e7eb;padding:12px 0}.total{font-size:24px;font-weight:800;border-bottom:0}.box{background:#f7fafc;padding:18px;border-radius:12px;margin-top:24px}@media print{body{padding:20px}}</style></head><body><h1>Tidyline</h1><div class="muted">CLEAN SPACES · BETTER LIVES</div><h2>INVOICE</h2><div class="row"><span>Invoice</span><strong>INV-${esc(booking.booking_ref||booking.id)}</strong></div><div class="row"><span>Booking</span><strong>${esc(booking.booking_ref||booking.id)}</strong></div><div class="box"><strong>Bill to</strong><p>${esc(booking.name)}<br>${esc(booking.email||'')}<br>${esc(booking.phone||'')}<br>${esc(booking.address||'')}</p></div><div class="row"><span>Service</span><strong>${esc(booking.type||'')}</strong></div><div class="row"><span>Date</span><strong>${esc(fmtDate(booking.date))}</strong></div><div class="row"><span>Time</span><strong>${esc(fmtTime(booking.start_time))} – ${esc(fmtTime(booking.end_time))}</strong></div><div class="row"><span>Payment status</span><strong>${esc((booking.payment_status||'unpaid').toUpperCase())}</strong></div><div class="row total"><span>Total</span><strong>${esc(total)}</strong></div><p class="muted">Currency: ${esc(c.code)} · Thank you for choosing Tidyline.</p><script>window.onload=()=>window.print();<\/script></body></html>`);
  win.document.close();
}

function switchView(view){
  document.querySelectorAll('.admin-view').forEach(section => { section.hidden = true; section.classList.remove('active-view'); });
  const target = $(`view-${view}`);
  if(!target) return;
  target.hidden = false;
  target.classList.add('active-view');
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => btn.classList.toggle('active',btn.dataset.view === view));
  const titles = {overview:'Overview',bookings:'Bookings',staff:'Staff'};
  $('viewTitle').textContent = titles[view] || 'Overview';
  closeSidebarMobile();
  window.scrollTo({top:0,behavior:'smooth'});
}

function openAudit(){
  $('auditTray').classList.add('open');
  $('auditTray').setAttribute('aria-hidden','false');
  $('auditOverlay').hidden = false;
}

function closeAudit(){
  $('auditTray').classList.remove('open');
  $('auditTray').setAttribute('aria-hidden','true');
  $('auditOverlay').hidden = true;
}

function openSidebarMobile(){ $('adminSidebar').classList.add('open'); $('sidebarOverlay').classList.add('show'); }
function closeSidebarMobile(){ $('adminSidebar').classList.remove('open'); $('sidebarOverlay').classList.remove('show'); }

function openSettings(){
  $('priceStandard').value = settings.price_standard ?? 45;
  $('priceDeep').value = settings.price_deep ?? 65;
  $('priceMove').value = settings.price_moveinout ?? 55;
  $('priceOffice').value = settings.price_office ?? 50;
  $('currencySelect').value = settings.currency || 'USD';
  $('settingsModal').classList.add('open');
  $('settingsModal').setAttribute('aria-hidden','false');
}

function closeSettings(){
  $('settingsModal').classList.remove('open');
  $('settingsModal').setAttribute('aria-hidden','true');
}

async function saveSettings(){
  const next = {id:1,price_standard:Number($('priceStandard').value)||0,price_deep:Number($('priceDeep').value)||0,price_moveinout:Number($('priceMove').value)||0,price_office:Number($('priceOffice').value)||0,currency:$('currencySelect').value || 'USD'};
  const {error} = await sb.from('settings').upsert(next);
  if(error){toast(error.message);return;}
  settings = {...settings,...next};
  await writeAudit('Service pricing updated.');
  closeSettings();
  toast('Pricing saved.');
  await loadData();
}

async function addStaff(event){
  event.preventDefault();
  const name = $('newStaff').value.trim();
  if(!name) return;
  const id = `s_${Date.now()}`;
  const {error} = await sb.from('staff').insert({id,name,active:true});
  if(error){toast(error.message);return;}
  $('newStaff').value = '';
  await writeAudit(`Staff member ${name} added.`);
  toast(`${name} added to the team.`);
  await loadData();
}

function exportCsv(){
  const headers = ['Booking Reference','Customer Name','Email','Phone','Address','Service','Date','Start Time','End Time','Staff','Status','Payment Status','Currency','Price','Created At'];
  const lines = [headers,...bookings.map(b => [b.booking_ref || b.id,b.name,b.email,b.phone || '',b.address || '',b.type,b.date,b.start_time,b.end_time,staff.find(s=>s.id===b.staff_id)?.name || '',b.status,b.payment_status || 'unpaid',settings.currency || 'USD',Number(b.price || 0).toFixed(2),b.created_at || ''])]
    .map(row => row.map(v => `"${String(v ?? '').replaceAll('"','""')}"`).join(','));
  const blob = new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tidyline-bookings-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function login(event){
  event.preventDefault();
  $('loginErr').textContent = '';
  $('loginBtn').disabled = true;
  $('loginBtn').textContent = 'Signing in…';
  const {error} = await sb.auth.signInWithPassword({email:$('adminEmail').value.trim(),password:$('adminPass').value});
  $('loginBtn').disabled = false;
  $('loginBtn').textContent = 'Sign in';
  if(error){$('loginErr').textContent = 'Unable to sign in. Please check your credentials.';return;}
  await showDashboard();
}

async function showDashboard(){
  $('loginView').hidden = true;
  $('adminApp').hidden = false;
  adminSessionActive = true;
  sessionStorage.setItem('tidyline_admin_active','1');
  applyFixedBrand();
  startInactivityWatch();
  await loadSettings();
  await loadData();
}

function bindEvents(){
  $('loginForm').addEventListener('submit',login);
  $('logoutBtn').addEventListener('click',logoutAdmin);
  $('topLogoutBtn').addEventListener('click',logoutAdmin);
  $('publicSiteLink').addEventListener('click',leaveAdminArea);
  $('mobileMenuBtn').addEventListener('click',openSidebarMobile);
  $('mobileSidebarClose').addEventListener('click',closeSidebarMobile);
  $('sidebarOverlay').addEventListener('click',closeSidebarMobile);
  $('auditNav').addEventListener('click',openAudit);
  $('closeAudit').addEventListener('click',closeAudit);
  $('auditOverlay').addEventListener('click',closeAudit);
  $('settingsBtn').addEventListener('click',openSettings);
  $('closeSettings').addEventListener('click',closeSettings);
  $('saveSettings').addEventListener('click',saveSettings);
  $('exportBtn').addEventListener('click',exportCsv);
  $('addStaffForm').addEventListener('submit',addStaff);
  $('searchBookings').addEventListener('input',renderBookings);
  $('statusFilter').addEventListener('change',renderBookings);
  $('overviewBookingsBtn').addEventListener('click',() => switchView('bookings'));
  $('stayLoggedIn').addEventListener('click',registerActivity);
  document.querySelectorAll('.sidebar-nav [data-view]').forEach(btn => btn.addEventListener('click',() => switchView(btn.dataset.view)));
  document.querySelectorAll('[data-view="staff"]').forEach(btn => btn.addEventListener('click',() => switchView('staff')));
}

sb.auth.onAuthStateChange((event,session) => {
  if(!session && adminSessionActive){
    adminSessionActive = false;
    stopInactivityWatch();
    sessionStorage.removeItem('tidyline_admin_active');
    location.replace('admin.html');
  }
});

bindEvents();

sb.auth.getSession().then(async ({data}) => {
  if(data.session) await showDashboard();
});
