/* ---------- پیکربندی Tailwind (باید قبل از اسکن Tailwind اجرا شود) ---------- */
if (window.tailwind) tailwind.config = { theme: { extend: {
  colors: { dairy: { leaf:'#2d6a4f', dark:'#1b4332', moss:'#1b4332', bg:'#f3f4f6', ink:'#1e293b',
    gold:'#f1c40f', coral:'#f87171', muted:'#64748b', line:'#e8e6de', cream:'#faf9f5' } },
  fontFamily: { sans:['Vazirmatn','sans-serif'] },
  boxShadow: { lifted:'0 18px 40px -24px rgba(27,67,50,.55)', soft:'0 1px 2px rgba(27,67,50,.04), 0 8px 24px -14px rgba(27,67,50,.18)' } } } };

/* ---------- کمک‌ابزار ---------- */
const fmt = (n) => Number(n||0).toLocaleString('fa-IR');
const ROLE_FA = { admin:'مدیر اصلی', accountant:'حسابداری', station:'متصدی سایت', store:'فروشگاه',
  distribution:'مدیر پخش', driver:'راننده', farmer:'دامدار', customer:'مشتری' };

async function api(path, opts={}) {
  const r = await fetch('/api'+path, { ...opts, credentials:'same-origin',
    headers:{ 'Content-Type':'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status===401 && !['/auth/login','/auth/me','/auth/bale'].includes(path)) { location.href='/login'; throw new Error('unauthorized'); }
  const d = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(d.error || 'خطا');
  return d;
}
async function currentUser(){ try { return (await api('/auth/me')).user; } catch { return null; } }
async function logout(){ try { await api('/auth/logout',{method:'POST'}); } catch {} location.href='/login'; }

/* گارد دسترسی: کاربر را می‌گیرد؛ اگر مجاز نبود ری‌دایرکت می‌کند */
async function guard(kinds){
  const u = await currentUser();
  if (!u) { location.href='/login'; return null; }
  if (kinds && !kinds.includes(u.kind)) { location.href = u.kind==='person' ? '/panel' : '/dashboard'; return null; }
  window.__user = u;
  return u;
}

/* ---------- هدر و ناوبری مشترک کارمندان ---------- */
const NAV = [
  { key:'dashboard', label:'داشبورد', icon:'fa-house', href:'/dashboard' },
  { key:'operations', label:'عملیات', icon:'fa-list-check', href:'/operations' },
  { key:'orders', label:'سفارش‌ها', icon:'fa-receipt', href:'/orders' },
  { key:'store', label:'فروشگاه', icon:'fa-store', href:'/store' },
  { key:'production', label:'تولید', icon:'fa-industry', href:'/production' },
  { key:'inventory', label:'انبار', icon:'fa-warehouse', href:'/inventory' },
  { key:'reports', label:'گزارش‌ها', icon:'fa-chart-pie', href:'/reports' },
  { key:'settings', label:'تنظیمات', icon:'fa-gear', href:'/settings', admin:true },
];
function mountChrome(active, title){
  const u = window.__user || {};
  const isAdmin = u.role === 'admin';
  const items = NAV.filter(n => !n.admin || isAdmin);
  const chip = `${u.name||''} — ${ROLE_FA[u.role]||u.role||''}${u.branch_name?(' @ '+u.branch_name):''}`;

  // هدر دسکتاپ (سبز)
  const top = document.createElement('header');
  top.className = 'skeu-header sticky top-0 z-40 text-white p-3 hidden md:block';
  top.innerHTML = `<div class="max-w-[1200px] mx-auto flex justify-between items-center gap-3">
    <div class="flex items-center gap-3 shrink-0"><i class="fa-solid fa-cow text-2xl"></i><h1 class="text-lg font-bold">مدیریت یکپارچه لبنیات</h1></div>
    <nav class="flex gap-2">${items.map(n=>`<a href="${n.href}" class="nav-pill ${n.key===active?'active':'hover:bg-white/10'} px-4 py-2 rounded-full text-sm">${n.label}</a>`).join('')}</nav>
    <div class="flex items-center gap-3 bg-white/10 px-3 py-1.5 rounded-lg text-xs shrink-0"><span>${chip}</span><a href="#" onclick="logout();return false" class="hover:text-red-300"><i class="fa-solid fa-right-from-bracket"></i> خروج</a></div>
  </div>`;

  // هدر موبایل (سفید، مطابق طرح موبایل)
  const mtop = document.createElement('header');
  mtop.className = 'md:hidden sticky top-0 z-40 bg-white/85 backdrop-blur-md border-b border-slate-100 p-4 flex items-center justify-between';
  mtop.innerHTML = `<div class="flex items-center gap-2"><div class="w-9 h-9 rounded-xl bg-dairy-dark text-white flex items-center justify-center"><i class="fa-solid fa-cow"></i></div><h1 class="text-base font-black text-slate-800">${title||'MilkWear'}</h1></div>
    <button onclick="logout()" class="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500"><i class="fa-solid fa-right-from-bracket"></i></button>`;

  // ناوبری پایین موبایل
  const bottom = document.createElement('nav');
  bottom.className = 'md:hidden fixed bottom-0 inset-x-0 z-40 px-3 pb-3 pt-1';
  const mItems = items.filter(n => ['dashboard','operations','orders','inventory','settings'].includes(n.key));
  bottom.innerHTML = `<div class="max-w-md mx-auto bg-white rounded-2xl shadow-lg border border-gray-200 flex items-center justify-around px-1 py-1">
    ${mItems.map(n=>`<a href="${n.href}" class="bnav ${n.key===active?'active':''} flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl"><i class="fa-solid ${n.icon} text-lg"></i><span class="text-[10px] font-bold">${n.label}</span></a>`).join('')}
  </div>`;

  document.body.prepend(mtop); document.body.prepend(top); document.body.appendChild(bottom);
}

/* ---------- آپدیت لایو ---------- */
function live(fn, ms=15000){ fn(); const id=setInterval(()=>{ if(!document.hidden) fn(); }, ms); return id; }
