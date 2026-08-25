'use strict';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const esc = value => { const d = document.createElement('div'); d.textContent = value ?? ''; return d.innerHTML; };

let staff = [];
let bookings = [];
let logs = [];
let settings = { price_standard:45, price_deep:65, price_moveinout:55, price_office:50, currency:'USD' };
let staffAvailability = [];
let selectedStaffId = null;
const CURRENCIES = { USD:{code:'USD',symbol:'$',name:'US Dollar'}, GHS:{code:'GHS',symbol:'GH₵',name:'Ghana Cedi'}, EUR:{code:'EUR',symbol:'€',name:'Euro'}, GBP:{code:'GBP',symbol:'£',name:'British Pound'} };
function currencyInfo(code=settings.currency){ return CURRENCIES[code] || CURRENCIES.USD; }
function money(value,code=settings.currency){ const c=currencyInfo(code); return `${c.symbol}${Number(value||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
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

function periodHoursAndRevenue(staffId,start,end){
  return bookings.filter(b => b.staff_id === staffId && b.status === 'completed' && b.date >= start && b.date < end)
    .reduce((acc,b) => { acc.hours += durationHours(b.start_time,b.end_time); acc.revenue += Number(b.price||0); return acc; },{hours:0,revenue:0});
}
function staffHours(staffId,date){ return periodHoursAndRevenue(staffId,weekStart(date),weekEnd(date)).hours; }
function monthStart(date){ return `${date.slice(0,7)}-01`; }
function monthEnd(date){ const d=new Date(`${monthStart(date)}T00:00:00`); d.setMonth(d.getMonth()+1); return d.toISOString().slice(0,10); }
function payeGhana(income){ const bands=[[490,0],[110,.05],[130,.10],[3166.67,.175],[16000,.25],[30520,.30],[Infinity,.35]]; let r=Math.max(0,Number(income)||0),t=0; for(const [w,rate] of bands){const x=Math.min(r,w);t+=x*rate;r-=x;if(r<=0)break;} return t; }

function staffMetrics(member,date=new Date().toISOString().slice(0,10)){
  const week=periodHoursAndRevenue(member.id,weekStart(date),weekEnd(date));
  const month=periodHoursAndRevenue(member.id,monthStart(date),monthEnd(date));
  const payType=member.pay_type || 'hourly';
  const hourly=Number(member.hourly_rate||0);
  const base=Number(member.base_salary||0);
  const standardMonthlyHours=160;
  const overtime=Math.max(0,month.hours-standardMonthlyHours);
  const gross=payType==='monthly' ? base + overtime*hourly*1.5 : month.hours*hourly;
  const basic=payType==='monthly' ? base : Math.min(gross, standardMonthlyHours*hourly);
  const ssnit=Math.min(Math.max(basic,587.80),69000)*0.055;
  const tax=payeGhana(Math.max(0,gross-ssnit));
  const adminCharge=gross*0.10;
  const deductions=Number(member.other_deductions||0);
  const net=Math.max(0,gross-ssnit-tax-adminCharge-deductions);
  return {week,month,gross,ssnit,tax,adminCharge,deductions,net,overtime};
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
  const defaults={id:1,price_standard:45,price_deep:65,price_moveinout:55,price_office:50,currency:'USD'};
  try{
    const {data,error}=await sb.from('settings').select('id,price_standard,price_deep,price_moveinout,price_office,currency').eq('id',1).maybeSingle();
    if(error) console.warn('Settings load failed:',error.message);
    if(data) settings={...settings,...data};
    else {
      const {data:created,error:createError}=await sb.from('settings').upsert(defaults,{onConflict:'id'}).select().maybeSingle();
      if(!createError && created) settings={...settings,...created};
      else if(createError) console.warn('Could not initialize settings; using safe defaults:',createError.message);
    }
  }catch(e){ console.warn('Settings initialization failed; using safe defaults:',e); }
  settings.currency=CURRENCIES[settings.currency] ? settings.currency : 'USD';
  applyFixedBrand();
}

async function loadData(){
  const [staffRes,bookingRes,logRes,availabilityRes] = await Promise.all([
    sb.from('staff').select('*').order('created_at',{ascending:true}),
    sb.from('bookings').select('*').order('date',{ascending:false}).order('start_time',{ascending:true}),
    sb.from('activity_log').select('*').order('created_at',{ascending:false}).limit(100),
    sb.from('staff_availability').select('*').order('start_date',{ascending:false})
  ]);
  if(staffRes.error || bookingRes.error || logRes.error) toast('Some dashboard data could not be loaded.');
  staff = staffRes.data || [];
  bookings = bookingRes.data || [];
  logs = logRes.data || [];
  staffAvailability = availabilityRes.error ? [] : (availabilityRes.data || []);
  if(availabilityRes.error && !String(availabilityRes.error.message || '').toLowerCase().includes('staff_availability')) console.warn('Availability load failed:',availabilityRes.error.message);
  renderAll();
}

function renderAll(){ renderStats(); renderBookings(); renderStaff(); renderOverview(); renderAudit(); updatePendingBadge(); renderCustomers(); renderInvoices(); renderPayroll(); renderReports(); }

function renderStats(){
  const today = new Date().toISOString().slice(0,10);
  const upcoming = bookings.filter(b => b.date >= today && b.status !== 'cancelled').length;
  const pending = bookings.filter(b => b.status === 'pending').length;
  const assigned = bookings.filter(b => b.status === 'assigned').length;
  const completed = bookings.filter(b => b.status === 'completed').length;
  const currentCurrency=currencyInfo().code; const revenue = bookings.filter(b => b.status !== 'cancelled' && (b.currency || currentCurrency) === currentCurrency).reduce((sum,b) => sum + Number(b.price || 0),0);
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
  }).sort((a,b) => {
    const rank={pending:0,assigned:1,in_progress:2,completed:3,cancelled:4};
    const sr=(rank[a.status]??9)-(rank[b.status]??9);
    if(sr!==0) return sr;
    return `${a.date||''}T${a.start_time||'00:00'}`.localeCompare(`${b.date||''}T${b.start_time||'00:00'}`);
  });

  $('bookingRows').innerHTML = rows.length ? rows.map(renderBookingRow).join('') : `<tr><td colspan="8"><div class="empty-state"><strong>No bookings found</strong><small>Try a different search or status filter.</small></div></td></tr>`;
  document.querySelectorAll('.staff-select').forEach(select => select.addEventListener('change',() => assignBooking(select.dataset.id,select.value)));
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click',() => bookingAction(button.dataset.action,button.dataset.id)));
}

function renderBookingRow(b){
  const serviceDate = b.date || new Date().toISOString().slice(0,10);
  const available = staff.filter(s=>s.active && isStaffAssignable(s.id,serviceDate));
  const selected = b.staff_id ? staff.find(s=>s.id===b.staff_id) : null;
  const selectedOption = selected && !available.some(s=>s.id===selected.id) ? `<option value="${esc(selected.id)}" selected>${esc(selected.name)} (currently unavailable)</option>` : '';
  const options = `<option value="">Keep pending / unassigned</option>${selectedOption}` + available.filter(s=>s.id!==b.staff_id).map(s => `<option value="${esc(s.id)}" ${s.id === b.staff_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  return `<tr>
    <td data-label="Booking"><strong>${esc(b.booking_ref || b.id)}</strong><small>${esc((b.created_at || '').slice(0,10))}</small></td>
    <td data-label="Customer"><strong>${esc(b.name)}</strong><small>${esc(b.email || '')}</small></td>
    <td data-label="Schedule"><strong>${fmtDate(b.date)}</strong><small>${fmtTime(b.start_time)} – ${fmtTime(b.end_time)}</small></td>
    <td data-label="Service">${esc(b.type || '')}</td>
    <td data-label="Staff"><strong>${esc(selected?.name || 'Unassigned')}</strong><select class="staff-select" data-id="${esc(b.id)}" aria-label="Assign staff to ${esc(b.booking_ref || b.id)}">${options}</select></td>
    <td data-label="Status"><span class="status status-${esc(b.status)}">${esc(b.status)}</span></td>
    <td data-label="Total"><strong>${money(b.price,b.currency || settings.currency)}</strong><small>${esc(b.currency || settings.currency || 'USD')}</small></td>
    <td data-label="Actions"><div class="action-row"> 
      ${b.status !== 'completed' && b.status !== 'cancelled' ? `<button data-action="complete" data-id="${esc(b.id)}">Complete</button>` : ''}
      ${b.status !== 'cancelled' ? `<button data-action="cancel" data-id="${esc(b.id)}">Cancel</button>` : ''}
      <button data-action="invoice" data-id="${esc(b.id)}">Invoice</button><button data-action="print" data-id="${esc(b.id)}">Print</button><button data-action="delete" data-id="${esc(b.id)}">Delete</button>
    </div></td>
  </tr>`;
}

const STAFF_STATUS = {
  available:{label:'Available',detail:'Can receive assignments'},
  unavailable:{label:'Unavailable',detail:'Temporarily unavailable'},
  leave:{label:'On Leave',detail:'Approved leave'},
  sick:{label:'Sick Off',detail:'Unavailable due to illness'},
  day_off:{label:'Day Off',detail:'Scheduled day off'},
  inactive:{label:'Inactive',detail:'Not in dispatch pool'}
};

function getStaffStatus(staffId,date){
  const member = staff.find(s => s.id === staffId);
  if(!member || !member.active) return 'inactive';
  const matches = staffAvailability.filter(a => a.staff_id === staffId && a.start_date <= date && (!a.end_date || a.end_date >= date));
  if(!matches.length) return 'available';
  return matches.sort((a,b)=>String(b.start_date).localeCompare(String(a.start_date)))[0].status || 'available';
}

function isStaffAssignable(staffId,date){
  return getStaffStatus(staffId,date) === 'available';
}

function openStaffStatus(staffId){
  const member = staff.find(s=>s.id===staffId);
  if(!member) return;
  $('staffStatusId').value = staffId;
  $('staffStatusTitle').textContent = `Availability — ${member.name}`;
  const current = getStaffStatus(staffId,new Date().toISOString().slice(0,10));
  $('staffStatusSelect').value = current;
  $('staffStatusStart').value = new Date().toISOString().slice(0,10);
  $('staffStatusEnd').value = new Date().toISOString().slice(0,10);
  $('staffStatusReason').value = '';
  $('staffStatusModal').classList.add('open');
  $('staffStatusModal').setAttribute('aria-hidden','false');
}

function closeStaffStatus(){
  $('staffStatusModal').classList.remove('open');
  $('staffStatusModal').setAttribute('aria-hidden','true');
}

async function saveStaffStatus(){
  const staffId=$('staffStatusId').value, status=$('staffStatusSelect').value;
  const start=$('staffStatusStart').value, end=$('staffStatusEnd').value, reason=$('staffStatusReason').value.trim();
  if(!staffId || !start || !end){toast('Choose a staff member and date range.');return;}
  if(end < start){toast('End date cannot be before start date.');return;}
  // Availability is a state, not another overlapping leave record. Remove records
  // that overlap the selected range so a person can always be returned to Available.
  const {error:clearError}=await sb.from('staff_availability').delete().eq('staff_id',staffId).lte('start_date',end).or(`end_date.is.null,end_date.gte.${start}`);
  if(clearError){toast(clearError.message);return;}
  if(status !== 'available'){
    const {error}=await sb.from('staff_availability').insert({staff_id:staffId,status,start_date:start,end_date:end,reason});
    if(error){toast(error.message);return;}
  }
  const member=staff.find(s=>s.id===staffId);
  await writeAudit(`${member?.name || 'Staff member'} availability changed to ${STAFF_STATUS[status].label} (${start} to ${end}).`);
  closeStaffStatus(); toast(`${member?.name || 'Staff member'} is now ${STAFF_STATUS[status].label}.`); await loadData();
}

function renderStaff(){
  const today = new Date().toISOString().slice(0,10);
  $('staffList').innerHTML = staff.length ? staff.map(s => {
    const metrics=staffMetrics(s,today);
    const pct = Math.min(metrics.week.hours/40*100,100);
    const initials = s.name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
    const status = getStaffStatus(s.id,today);
    const meta = STAFF_STATUS[status] || STAFF_STATUS.available;
    return `<article class="staff-card"><div class="staff-card-top"><div class="mini-avatar">${esc(initials)}</div><div><strong>${esc(s.name)}</strong><small>${esc(s.job_title || 'Service professional')} · ${s.active ? 'Active' : 'Inactive'}</small></div></div><div class="staff-status-line"><span class="availability-dot availability-${status}"></span><strong>${esc(meta.label)}</strong><small>${esc(meta.detail)}</small></div><div class="staff-mini-metrics"><span><b>${metrics.week.hours.toFixed(1)}h</b><small>week</small></span><span><b>${metrics.month.hours.toFixed(1)}h</b><small>month</small></span><span><b>${money(metrics.month.revenue)}</b><small>job revenue</small></span></div><div class="mini-bar"><span style="width:${pct}%"></span></div><div class="staff-card-actions"><button class="btn btn-secondary staff-status-btn" type="button" data-staff-profile="${esc(s.id)}">Availability & profile</button></div></article>`;
  }).join('') : `<div class="empty-state"><strong>No staff members</strong><small>Add your first professional.</small></div>`;
  document.querySelectorAll('[data-staff-status]').forEach(btn => btn.addEventListener('click',() => openStaffStatus(btn.dataset.staffStatus)));
  document.querySelectorAll('[data-staff-profile]').forEach(btn => btn.addEventListener('click',() => openStaffProfile(btn.dataset.staffProfile)));
}

function openStaffProfile(staffId){
  const member=staff.find(s=>s.id===staffId); if(!member) return;
  selectedStaffId=staffId;
  const today=new Date().toISOString().slice(0,10), m=staffMetrics(member,today);
  $('staffProfileId').value=staffId;
  $('staffProfileTitle').textContent=member.name;
  $('staffName').value=member.name||''; $('staffEmail').value=member.email||''; $('staffPhone').value=member.phone||'';
  $('staffEmployeeId').value=member.employee_id||''; $('staffJobTitle').value=member.job_title||''; $('staffAddress').value=member.address||'';
  $('staffHireDate').value=member.hire_date||''; $('staffPayType').value=member.pay_type||'hourly'; $('staffHourlyRate').value=member.hourly_rate??0;
  $('staffBaseSalary').value=member.base_salary??0; $('staffTaxRate').value=member.tax_rate??0; $('staffDeductions').value=member.other_deductions??0;
  $('staffEmergencyName').value=member.emergency_contact_name||''; $('staffEmergencyPhone').value=member.emergency_contact_phone||''; $('staffNotes').value=member.notes||'';
  $('staffWeekHours').textContent=m.week.hours.toFixed(1)+'h'; $('staffWeekRevenue').textContent=money(m.week.revenue); $('staffMonthHours').textContent=m.month.hours.toFixed(1)+'h'; $('staffMonthRevenue').textContent=money(m.month.revenue);
  $('staffGross').textContent=money(m.gross); $('staffTax').textContent=money(m.tax); $('staffNet').textContent=money(m.net);
  $('staffProfileModal').classList.add('open'); $('staffProfileModal').setAttribute('aria-hidden','false');
}
function closeStaffProfile(){ $('staffProfileModal').classList.remove('open'); $('staffProfileModal').setAttribute('aria-hidden','true'); }
async function saveStaffProfile(){
  const id=$('staffProfileId').value; if(!id) return;
  const patch={name:$('staffName').value.trim(),email:$('staffEmail').value.trim()||null,phone:$('staffPhone').value.trim()||null,employee_id:$('staffEmployeeId').value.trim()||null,job_title:$('staffJobTitle').value.trim()||null,address:$('staffAddress').value.trim()||null,hire_date:$('staffHireDate').value||null,pay_type:$('staffPayType').value,hourly_rate:Number($('staffHourlyRate').value)||0,base_salary:Number($('staffBaseSalary').value)||0,tax_rate:Number($('staffTaxRate').value)||0,other_deductions:Number($('staffDeductions').value)||0,emergency_contact_name:$('staffEmergencyName').value.trim()||null,emergency_contact_phone:$('staffEmergencyPhone').value.trim()||null,notes:$('staffNotes').value.trim()||null};
  if(!patch.name){toast('Staff name is required.');return;}
  const {error}=await sb.from('staff').update(patch).eq('id',id); if(error){toast(error.message);return;}
  await writeAudit(`Staff profile updated for ${patch.name}.`); closeStaffProfile(); toast('Staff profile saved.'); await loadData();
}

function renderAudit(){
  $('activityList').innerHTML = logs.length ? logs.map(log => `<article class="audit-item"><button class="audit-delete" type="button" data-audit-delete="${esc(log.id)}" aria-label="Delete this history item" title="Delete history item">×</button><strong>${esc(log.message || 'System activity')}</strong><small>${new Date(log.created_at).toLocaleString()}</small></article>`).join('') : `<div class="empty-state"><strong>No audit activity</strong><small>Administrative events will appear here.</small></div>`;
  $('activityList').querySelectorAll('[data-audit-delete]').forEach(btn => btn.addEventListener('click',()=>deleteAuditItem(btn.dataset.auditDelete)));
}

async function deleteAuditItem(id){
  if(!id) return;
  if(!confirm('Delete this audit history item?')) return;
  let {data,error}=await sb.rpc('delete_audit_log',{p_log_id:id});
  if(error){
    const fallback=await sb.from('activity_log').delete().eq('id',id).select('id');
    error=fallback.error; data=!!(fallback.data && fallback.data.length);
  }
  if(error){toast(`History item could not be deleted: ${error.message}`);return;}
  if(data===false){toast('History item was not found.');return;}
  logs=logs.filter(x=>String(x.id)!==String(id)); renderAudit(); toast('History item deleted.');
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
  if(!member || !member.active){ toast('That staff member is not active.'); return; }
  if(!isStaffAssignable(staffId, booking.date)){ toast(`${member.name} is not available on ${fmtDate(booking.date)}.`); return; }
  const {error} = await sb.from('bookings').update({staff_id:staffId,status:'assigned'}).eq('id',bookingId);
  if(error){toast(error.message);return;}
  await writeAudit(`Booking ${booking.booking_ref || bookingId} assigned to ${member?.name || 'staff member'}.`);
  toast(`Assigned to ${member?.name || 'staff member'}.`);
  await loadData();
}

async function deleteBooking(id){
  const booking=bookings.find(b=>b.id===id); if(!booking) return;
  if(!confirm(`Delete booking ${booking.booking_ref||id}? This cannot be undone.`)) return;
  const {data,error}=await sb.rpc('delete_booking',{p_booking_id:id}); if(error){toast(error.message);return;}
  if(!data){toast('Booking was not found.');return;}
  await writeAudit(`Booking ${booking.booking_ref||id} deleted.`); toast('Booking deleted.'); await loadData();
}

async function clearAuditHistory(){
  if(!confirm('Clear the entire Audit Tray history? This cannot be undone.')) return;
  let {error}=await sb.rpc('clear_audit_history');
  if(error){
    const fallback=await sb.from('activity_log').delete().not('created_at','is',null);
    error=fallback.error;
  }
  if(error){toast(`Audit history could not be cleared: ${error.message}`);return;}
  logs=[]; renderAudit(); toast('Audit Tray cleared.');
}


async function freshStart(){
  const phrase=prompt('This permanently deletes operational Tidyline data and cannot be undone. Type RESET TIDYLINE to continue.');
  if(phrase!=='RESET TIDYLINE'){ if(phrase!==null) toast('Fresh start cancelled.'); return; }
  let {error}=await sb.rpc('reset_tidyline_system',{p_confirmation:'RESET TIDYLINE'});
  if(error){
    const tables=['activity_log','staff_availability','invoices','bookings','customers','staff'];
    error=null;
    for(const table of tables){
      const probe=await sb.from(table).select('*',{head:true,count:'exact'});
      if(probe.error){
        if(/relation|does not exist|schema cache/i.test(probe.error.message || '')) continue;
        error=probe.error; break;
      }
      const column = table==='activity_log' ? 'created_at' : 'id';
      const result=await sb.from(table).delete().not(column,'is',null);
      if(result.error){ error=result.error; break; }
    }
  }
  if(error){toast(`Fresh start failed: ${error.message}`);return;}
  toast('Tidyline has been reset for a fresh start.'); await loadSettings(); await loadData(); switchView('overview');
}


async function bookingAction(type,id){
  const booking = bookings.find(b => b.id === id);
  if(!booking) return;
  if(type === 'invoice') return openInvoicePreview(booking);
  if(type === 'print') return printInvoice(booking);
  if(type === 'delete') return deleteBooking(id);
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
    if(!booking.email){ toast('This booking has no customer email address.'); return; }
    const payload={type:'invoice',booking:{name:booking.name,email:booking.email,phone:booking.phone,type:booking.type,date:booking.date,start_time:booking.start_time,end_time:booking.end_time,address:booking.address,price:booking.price,booking_ref:booking.booking_ref,currency:booking.currency || settings.currency || 'USD',payment_status:booking.payment_status || 'unpaid'}};
    const {data,error}=await sb.functions.invoke('send-email',{body:payload});
    if(error) throw error;
    if(data && data.ok === false) throw new Error(data.error || 'Email function failed.');
    toast('Invoice email sent successfully.');
    await writeAudit(`Invoice sent for booking ${booking.booking_ref || booking.id}.`);
  }catch(error){ console.error('Invoice email error:',error); toast(`Invoice could not be sent: ${error.message || 'check email setup'}`); }
}

function invoiceHtml(booking){
  const c=currencyInfo(booking.currency || settings.currency);
  const total=money(booking.price,booking.currency || settings.currency);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${esc(booking.booking_ref||booking.id)}</title><style>body{font-family:Arial,sans-serif;color:#14213d;padding:40px;max-width:760px;margin:auto;line-height:1.5}h1{margin:0;font-size:30px}.muted{color:#667085}.row{display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid #e5e7eb;padding:12px 0}.total{font-size:24px;font-weight:800;border-bottom:0}.box{background:#f7fafc;padding:18px;border-radius:12px;margin-top:24px}@media(max-width:600px){body{padding:20px}.row{gap:12px;flex-wrap:wrap}}@media print{body{padding:15mm} .no-print{display:none!important}}</style></head><body><div class="no-print" style="text-align:right;margin-bottom:20px"><button onclick="window.print()">Print invoice</button></div><h1>Tidyline</h1><div class="muted">CLEAN SPACES · BETTER LIVES</div><h2>INVOICE</h2><div class="row"><span>Invoice</span><strong>INV-${esc(booking.booking_ref||booking.id)}</strong></div><div class="row"><span>Booking</span><strong>${esc(booking.booking_ref||booking.id)}</strong></div><div class="box"><strong>Bill to</strong><p>${esc(booking.name)}<br>${esc(booking.email||'')}<br>${esc(booking.phone||'')}<br>${esc(booking.address||'')}</p></div><div class="row"><span>Service</span><strong>${esc(booking.type||'')}</strong></div><div class="row"><span>Date</span><strong>${esc(fmtDate(booking.date))}</strong></div><div class="row"><span>Time</span><strong>${esc(fmtTime(booking.start_time))} – ${esc(fmtTime(booking.end_time))}</strong></div><div class="row"><span>Payment status</span><strong>${esc((booking.payment_status||'unpaid').toUpperCase())}</strong></div><div class="row total"><span>Total</span><strong>${esc(total)}</strong></div><p class="muted">Currency: ${esc(c.code)} · Thank you for choosing Tidyline.</p></body></html>`;
}

function downloadInvoice(booking){
  const blob=new Blob([invoiceHtml(booking)],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`invoice-${booking.booking_ref || booking.id}.html`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('Invoice downloaded. Open it and choose Print → Save as PDF if needed.');
}

function printInvoice(booking){
  const html=invoiceHtml(booking);
  const win=window.open('', '_blank');
  if(win){
    win.document.open(); win.document.write(html); win.document.close();
    setTimeout(()=>{try{win.focus();win.print();}catch(e){console.warn(e);}},500);
    return;
  }
  // Popup-blocker fallback: print through a temporary iframe.
  const iframe=document.createElement('iframe');
  iframe.style.position='fixed'; iframe.style.width='1px'; iframe.style.height='1px'; iframe.style.border='0'; iframe.style.right='0'; iframe.style.bottom='0';
  document.body.appendChild(iframe);
  const doc=iframe.contentWindow.document; doc.open(); doc.write(html); doc.close();
  setTimeout(()=>{try{iframe.contentWindow.focus();iframe.contentWindow.print();}finally{setTimeout(()=>iframe.remove(),1000);}},300);
}

function openInvoicePreview(booking){
  let modal=$('invoicePreviewModal');
  if(!modal){
    modal=document.createElement('div'); modal.id='invoicePreviewModal'; modal.className='modal'; modal.setAttribute('aria-hidden','true');
    modal.innerHTML='<div class="modal-card invoice-preview-card" role="dialog" aria-modal="true"><button class="modal-close" id="closeInvoicePreview" type="button" aria-label="Close invoice">×</button><div id="invoicePreviewContent"></div><div class="invoice-actions"><button class="btn btn-secondary" id="previewPrintBtn" type="button">Print / Save PDF</button><button class="btn btn-secondary" id="previewDownloadBtn" type="button">Download invoice</button><button class="btn btn-primary" id="previewSendBtn" type="button">Send invoice by email</button></div></div>';
    document.body.appendChild(modal);
    $('closeInvoicePreview').addEventListener('click',()=>{modal.classList.remove('open');modal.setAttribute('aria-hidden','true');});
  }
  $('invoicePreviewContent').innerHTML=invoiceHtml(booking).replace(/<html>|<\/html>|<head>[\s\S]*?<\/head>|<body>|<\/body>/gi,'');
  $('previewPrintBtn').onclick=()=>printInvoice(booking);
  $('previewDownloadBtn').onclick=()=>downloadInvoice(booking);
  $('previewSendBtn').onclick=()=>sendInvoice(booking);
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
}

function renderCustomers(){
  const q=(($('searchCustomers')?.value)||'').trim().toLowerCase();
  const map=new Map();
  bookings.forEach(b=>{
    const key=(b.email||b.phone||b.name||'').toLowerCase(); if(!key)return;
    const x=map.get(key)||{name:b.name||'Customer',email:b.email||'',phone:b.phone||'',bookings:0,completed:0,spent:0};
    x.bookings++; if(b.status==='completed')x.completed++; if(b.status!=='cancelled')x.spent+=Number(b.price||0); map.set(key,x);
  });
  const rows=[...map.values()].filter(x=>`${x.name} ${x.email} ${x.phone}`.toLowerCase().includes(q));
  const el=$('customerRows'); if(!el)return;
  el.innerHTML=rows.length?rows.map(c=>`<tr><td><strong>${esc(c.name)}</strong></td><td><small>${esc(c.email||'No email')}</small><small>${esc(c.phone||'No phone')}</small></td><td>${c.bookings}</td><td>${c.completed}</td><td><strong>${money(c.spent)}</strong></td></tr>`).join(''):`<tr><td colspan="5"><div class="empty-state"><strong>No customers found</strong><small>Customers appear after bookings are made.</small></div></td></tr>`;
}
function renderInvoices(){const el=$('invoiceRows');if(!el)return;const rows=[...bookings].sort((a,b)=>`${b.date} ${b.start_time||''}`.localeCompare(`${a.date} ${a.start_time||''}`));el.innerHTML=rows.length?rows.map(b=>`<tr><td><strong>INV-${esc(b.booking_ref||b.id)}</strong></td><td>${esc(b.name||'—')}</td><td>${esc(b.booking_ref||b.id)}</td><td>${esc(fmtDate(b.date))}</td><td>${esc(money(b.price,b.currency||settings.currency))}</td><td><span class="status-chip status-${(b.payment_status||'unpaid')==='paid'?'completed':'pending'}">${esc(b.payment_status||'unpaid')}</span></td><td><div class="action-row"><button type="button" data-invoice="${esc(b.id)}">View / Print</button></div></td></tr>`).join(''):`<tr><td colspan="7"><div class="empty-state"><strong>No invoices yet</strong></div></td></tr>`;el.querySelectorAll('[data-invoice]').forEach(x=>x.onclick=()=>{const b=bookings.find(y=>y.id===x.dataset.invoice);if(b)openInvoicePreview(b)})}
function payrollPeriod(){
  const input=$('payrollMonth');
  const value=input?.value || new Date().toISOString().slice(0,7);
  return {value,start:`${value}-01`,end:monthEnd(`${value}-01`)};
}
function renderPayroll(){
  const input=$('payrollMonth'); if(!input) return;
  const current=new Date().toISOString().slice(0,7); if(!input.value) input.value=current;
  const {value,start,end}=payrollPeriod();
  const monthBookings=bookings.filter(b=>b.date>=start&&b.date<end&&b.status!=='cancelled');
  const rows=staff.map(member=>{
    const met=staffMetrics(member,`${value}-15`);
    // staffMetrics uses the current month; calculate the selected month directly for payroll.
    const work=periodHoursAndRevenue(member.id,start,end);
    const payType=member.pay_type||'hourly', hourly=Number(member.hourly_rate||0), base=Number(member.base_salary||0), standard=160;
    const overtime=Math.max(0,work.hours-standard);
    const gross=payType==='monthly'?base+overtime*hourly*1.5:work.hours*hourly;
    const basic=payType==='monthly'?base:Math.min(gross,standard*hourly);
    const ssnit=Math.min(Math.max(basic,587.80),69000)*0.055;
    const taxable=Math.max(0,gross-ssnit);
    const tax=payeGhana(taxable);
    const adminCharge=gross*0.10;
    const other=Number(member.other_deductions||0);
    const net=Math.max(0,gross-ssnit-tax-adminCharge-other);
    return {member,work,gross,ssnit,tax,adminCharge,other,net};
  });
  const total=r=>rows.reduce((sum,x)=>sum+x[r],0);
  $('payrollPeriodLabel').textContent=new Date(`${value}-01T00:00:00`).toLocaleDateString(undefined,{month:'long',year:'numeric'});
  $('payrollSummary').innerHTML=[
    ['Gross payroll',money(total('gross')),'Before deductions'],
    ['Employee SSNIT',money(total('ssnit')),'5.5% of basic'],
    ['PAYE',money(total('tax')),'Graduated bands'],
    ['Net payroll',money(total('net')),'After deductions']
  ].map(x=>`<article class="payroll-summary-card"><small>${x[0]}</small><strong>${x[1]}</strong><span>${x[2]}</span></article>`).join('');
  $('payrollRows').innerHTML=rows.length?rows.map(x=>`<tr><td><strong>${esc(x.member.name)}</strong><small>${esc(x.member.job_title||'Service professional')}</small></td><td>${x.work.hours.toFixed(1)}h</td><td>${money(x.gross)}</td><td>${money(x.ssnit)}</td><td>${money(x.tax)}</td><td>${money(x.adminCharge)}</td><td>${money(x.other)}</td><td class="net-cell">${money(x.net)}</td></tr>`).join(''):`<tr><td colspan="8"><div class="empty-state">No staff records available.</div></td></tr>`;
}

function renderReports(){const el=$('reportCards');if(!el)return;const today=new Date().toISOString().slice(0,10),ms=monthStart(today),me=monthEnd(today),m=bookings.filter(b=>b.date>=ms&&b.date<me&&b.status!=='cancelled'),rev=m.reduce((s,b)=>s+Number(b.price||0),0),done=m.filter(b=>b.status==='completed').length,h=m.reduce((s,b)=>s+durationHours(b.start_time,b.end_time),0);el.innerHTML=[[money(rev),'Month revenue','Recorded value'],[m.length,'Bookings','This month'],[done,'Completed','This month'],[h.toFixed(1)+'h','Recorded hours','Timed jobs']].map(x=>`<article class="report-card"><small>${x[1]}</small><strong>${x[0]}</strong><span>${x[2]}</span></article>`).join('');$('reportStaffRows').innerHTML=staff.map(s=>{const met=staffMetrics(s);const jobs=m.filter(b=>b.staff_id===s.id&&b.status!=='cancelled').length;return `<tr><td><strong>${esc(s.name||'Staff')}</strong></td><td>${jobs}</td><td>${met.month.hours.toFixed(1)}h</td><td>${money(met.month.revenue)}</td><td>${money(met.gross)}</td><td>${money(met.net)}</td></tr>`}).join('')||`<tr><td colspan="6"><div class="empty-state">No staff data available.</div></td></tr>`}


let availabilityRequests = [];

async function loadAvailabilityRequests(){
  const el=$('availabilityRequestsList');
  if(!el) return;
  const {data,error}=await sb.rpc('get_staff_availability_requests');
  if(error){ el.innerHTML=`<div class="empty-state"><strong>Requests unavailable</strong><small>${esc(error.message)}</small></div>`; return; }
  availabilityRequests=data||[];
  renderAvailabilityRequests();
}

function renderAvailabilityRequests(){
  const el=$('availabilityRequestsList'); if(!el) return;
  if(!availabilityRequests.length){el.innerHTML='<div class="empty-state"><strong>No availability requests</strong><small>Staff absence and availability requests will appear here.</small></div>';return;}
  el.innerHTML=availabilityRequests.map(r=>{
    const pending=r.approval_status==='pending';
    const conflicts=bookings.filter(b=>b.staff_id===r.staff_id&&b.date>=r.start_date&&b.date<=r.end_date&&!['cancelled','completed'].includes(b.status)).length;
    return `<article class="audit-row" style="display:flex;gap:14px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap">
      <div style="min-width:220px;flex:1"><strong>${esc(r.staff_name||r.staff_id)}</strong><small>${esc(statusLabel(r.request_status))} · ${esc(fmtDate(r.start_date))} → ${esc(fmtDate(r.end_date))}</small><small>${esc(r.reason||'No reason provided')}</small>${conflicts?`<small style="color:#b54708;font-weight:700">⚠ ${conflicts} active booking${conflicts===1?'':'s'} overlap this period.</small>`:''}${r.admin_note?`<small>Admin: ${esc(r.admin_note)}</small>`:''}</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="status-chip status-${esc(r.approval_status==='approved'?'completed':r.approval_status==='rejected'?'cancelled':'pending')}">${esc(r.approval_status)}</span>${pending?`<button type="button" data-approve-request="${esc(r.id)}">Approve</button><button type="button" data-reject-request="${esc(r.id)}">Reject</button>`:''}</div>
    </article>`;
  }).join('');
  el.querySelectorAll('[data-approve-request]').forEach(b=>b.onclick=()=>reviewAvailabilityRequest(b.dataset.approveRequest,'approved'));
  el.querySelectorAll('[data-reject-request]').forEach(b=>b.onclick=()=>reviewAvailabilityRequest(b.dataset.rejectRequest,'rejected'));
}

function statusLabel(s){ return String(s||'').replaceAll('_',' ').replace(/\b\w/g,m=>m.toUpperCase()); }

async function reviewAvailabilityRequest(id,decision){
  let note='';
  if(decision==='rejected') note=window.prompt('Optional reason for rejection:','')||'';
  else note=window.prompt('Optional Admin note:','')||'';
  const {error}=await sb.rpc('review_staff_availability_request',{p_request_id:id,p_decision:decision,p_admin_note:note});
  if(error){toast(error.message);return;}
  toast(`Availability request ${decision}.`);
  await Promise.all([loadAvailabilityRequests(),loadData()]);
}

function switchView(view){
  document.querySelectorAll('.admin-view').forEach(section => { section.hidden = true; section.classList.remove('active-view'); });
  const target = $(`view-${view}`);
  if(!target) return;
  target.hidden = false;
  target.classList.add('active-view');
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => btn.classList.toggle('active',btn.dataset.view === view));
  const titles = {overview:'Overview',bookings:'Bookings',staff:'Staff',customers:'Customers',invoices:'Invoices',payroll:'Payroll',reports:'Reports'};
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
  const password = $('newStaffPassword').value;
  const email = $('newStaffEmail').value.trim();
  const phone = $('newStaffPhone').value.trim();
  const address = $('newStaffAddress').value.trim();
  if(!name || !email || !password || !phone){ toast('Name, email, phone and password are required.'); return; }
  if(password.length < 8){ toast('Staff password must be at least 8 characters.'); return; }
  const btn=$('addStaffBtn'); btn.disabled=true; btn.textContent='Creating account…';
  try{
    const {data,error}=await sb.functions.invoke('create-staff-account',{body:{name,email,phone,address,password}});
    if(error) throw error;
    if(!data?.success) throw new Error(data?.error || 'Unable to create staff account.');
    $('newStaffId').value=data.staff_id||'';
    $('newStaff').value=''; $('newStaffPassword').value=''; $('newStaffEmail').value=''; $('newStaffPhone').value=''; $('newStaffAddress').value='';
    await writeAudit(`Staff member ${name} onboarded with Staff ID ${data.staff_id}.`);
    toast(`${name} onboarded. Staff ID: ${data.staff_id}`);
    await loadData();
  }catch(err){ toast(err.message || 'Staff onboarding failed.'); }
  finally{ btn.disabled=false; btn.textContent='Create staff account'; }
}

async function previewNextStaffId(){
  const {data,error}=await sb.rpc('next_staff_id');
  if(!error && data) $('newStaffId').value=data;
}

function exportCsv(){
  const headers = ['Booking Reference','Customer Name','Email','Phone','Address','Service','Date','Start Time','End Time','Staff','Status','Payment Status','Currency','Price','Created At'];
  const lines = [headers,...bookings.map(b => [b.booking_ref || b.id,b.name,b.email,b.phone || '',b.address || '',b.type,b.date,b.start_time,b.end_time,staff.find(s=>s.id===b.staff_id)?.name || '',b.status,b.payment_status || 'unpaid',(b.currency || settings.currency || 'USD'),Number(b.price || 0).toFixed(2),b.created_at || ''])]
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
  await loadAvailabilityRequests();
}

function installUiGuards(){
  document.querySelectorAll('.modal').forEach(modal=>{
    const observer=new MutationObserver(()=>{
      const anyOpen=[...document.querySelectorAll('.modal.open')].length>0;
      document.body.classList.toggle('modal-open',anyOpen);
    });
    observer.observe(modal,{attributes:true,attributeFilter:['class']});
  });
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape') return;
    const openModal=document.querySelector('.modal.open');
    if(openModal){
      const close=openModal.querySelector('.modal-close');
      close?.click();
      return;
    }
    if($('auditTray')?.classList.contains('open')) closeAudit();
    else if($('adminSidebar')?.classList.contains('open')) closeSidebarMobile();
  });
  document.querySelectorAll('.modal').forEach(modal=>{
    modal.addEventListener('click',e=>{
      if(e.target===modal){
        modal.querySelector('.modal-close')?.click();
      }
    });
  });
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
  $('closeStaffStatus').addEventListener('click',closeStaffStatus);
  $('saveStaffStatus').addEventListener('click',saveStaffStatus);
  $('closeStaffProfile').addEventListener('click',closeStaffProfile);
  $('saveStaffProfile').addEventListener('click',saveStaffProfile);
  $('profileAvailabilityBtn').addEventListener('click',()=>{ const id=$('staffProfileId').value; closeStaffProfile(); openStaffStatus(id); });
  $('clearAuditBtn').addEventListener('click',clearAuditHistory);
  $('freshStartBtn').addEventListener('click',freshStart);
  $('searchBookings').addEventListener('input',renderBookings);
  $('statusFilter').addEventListener('change',renderBookings); $('searchCustomers')?.addEventListener('input',renderCustomers);
  $('overviewBookingsBtn').addEventListener('click',() => switchView('bookings'));
  $('stayLoggedIn').addEventListener('click',registerActivity);
  $('refreshAvailabilityRequests')?.addEventListener('click',loadAvailabilityRequests);
  $('payrollRefreshBtn')?.addEventListener('click',renderPayroll);
  $('payrollMonth')?.addEventListener('change',renderPayroll);
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
installUiGuards();
previewNextStaffId();

sb.auth.getSession().then(async ({data}) => {
  if(data.session) await showDashboard();
});
