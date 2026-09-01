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

/* پیام شناور (توست) */
function toast(msg, kind='ok'){
  let host=document.getElementById('mwToasts');
  if(!host){ host=document.createElement('div'); host.id='mwToasts'; host.style.cssText='position:fixed;z-index:9999;bottom:88px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none'; document.body.appendChild(host); }
  const bg=kind==='err'?'#dc2626':(kind==='warn'?'#d97706':'#16a34a');
  const el=document.createElement('div');
  el.style.cssText=`background:${bg};color:#fff;padding:10px 18px;border-radius:14px;font-weight:800;font-size:14px;box-shadow:0 10px 25px -8px rgba(0,0,0,.4);opacity:0;transition:opacity .2s,transform .2s;transform:translateY(8px)`;
  el.textContent=msg; host.appendChild(el);
  requestAnimationFrame(()=>{ el.style.opacity='1'; el.style.transform='translateY(0)'; });
  setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(8px)'; setTimeout(()=>el.remove(),250); }, 2600);
}

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
  { key:'operations', label:'تحویل شیر', icon:'fa-truck-droplet', href:'/operations' },
  { key:'orders', label:'سفارش‌ها و فروش', icon:'fa-receipt', href:'/orders' },
  { key:'production', label:'تولید', icon:'fa-industry', href:'/production' },
  { key:'inventory', label:'انبار', icon:'fa-warehouse', href:'/inventory' },
  { key:'reports', label:'گزارش‌ها', icon:'fa-chart-pie', href:'/reports' },
  { key:'settings', label:'تنظیمات', icon:'fa-gear', href:'/settings', admin:true },
];
function allowedPages(u){
  if (u && u.role === 'admin') return NAV.map(n=>n.key);
  if (u && Array.isArray(u.pages)) return u.pages;
  // پیش‌فرضِ سازگاری: همه جز تنظیمات
  return NAV.map(n=>n.key).filter(k=>k!=='settings');
}
function mountChrome(active, title){
  const u = window.__user || {};
  const isAdmin = u.role === 'admin';
  const pages = allowedPages(u);
  // اگر نقش به این صفحه دسترسی ندارد، به اولین صفحهٔ مجاز هدایت شود
  if (active && !pages.includes(active)) { location.href = '/'+(pages[0]||'dashboard'); return; }
  const items = NAV.filter(n => pages.includes(n.key));
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
  const mItems = items.filter(n => ['dashboard','operations','orders','inventory','reports','settings'].includes(n.key));
  bottom.innerHTML = `<div class="max-w-md mx-auto bg-white rounded-2xl shadow-lg border border-gray-200 flex items-center justify-around px-1 py-1">
    ${mItems.map(n=>`<a href="${n.href}" class="bnav ${n.key===active?'active':''} flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl"><i class="fa-solid ${n.icon} text-lg"></i><span class="text-[10px] font-bold">${n.label}</span></a>`).join('')}
  </div>`;

  document.body.prepend(mtop); document.body.prepend(top); document.body.appendChild(bottom);
}

// فهرست صفحاتِ قابل‌دسترسِ کاربر (برای منوی لانچر داشبوردِ نقش‌های محدود)
function accessiblePages(){ const u=window.__user||{}; const pages=allowedPages(u); return NAV.filter(n=>pages.includes(n.key)); }
// آیا این کاربر داشبوردِ تحلیلی می‌بیند یا فقط منوی صفحات؟
function seesDashboard(){ const u=window.__user||{}; return u.role==='admin' || allowedPages(u).includes('dashboard'); }
// رندر منوی لانچر داخل یک المان
function renderLauncher(el){ const items=accessiblePages().filter(n=>n.key!=='dashboard');
  el.innerHTML = `<div class="grid grid-cols-2 md:grid-cols-3 gap-4">${items.map(n=>`
    <a href="${n.href}" class="skeu-card p-6 flex flex-col items-center justify-center gap-3 text-center hover:ring-2 hover:ring-green-300 transition">
      <div class="w-14 h-14 rounded-2xl bg-green-50 text-green-700 flex items-center justify-center text-2xl"><i class="fa-solid ${n.icon}"></i></div>
      <span class="font-bold text-gray-800">${n.label}</span>
    </a>`).join('')}</div>`;
}

/* پیش‌نمایش چاپ حرارتی: تصویرِ دقیقِ خروجی را نشان می‌دهد، سپس دکمهٔ چاپ */
function previewThermal(imgUrl, onConfirm){
  let ov=document.getElementById('mwPrev');
  if(!ov){ ov=document.createElement('div'); ov.id='mwPrev'; ov.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px'; document.body.appendChild(ov); }
  ov.innerHTML=`<div style="background:#fff;border-radius:18px;max-width:360px;width:100%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden">
    <div style="padding:12px 16px;font-weight:800;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #eee">پیش‌نمایش چاپ<span id="mwPrevX" style="cursor:pointer;color:#888;font-size:22px">&times;</span></div>
    <div style="flex:1;overflow:auto;background:#f1f5f9;padding:12px;text-align:center"><div id="mwPrevBody" style="color:#94a3b8;padding:40px">در حال آماده‌سازی پیش‌نمایش…</div></div>
    <div style="padding:12px;display:flex;gap:8px;border-top:1px solid #eee">
      <button id="mwPrevCancel" style="flex:1;background:#f1f5f9;border-radius:12px;padding:12px;font-weight:800">بستن</button>
      <button id="mwPrevPrint" style="flex:2;background:#0f172a;color:#fff;border-radius:12px;padding:12px;font-weight:800"><i class="fa-solid fa-print"></i> چاپ حرارتی</button>
    </div></div>`;
  ov.style.display='flex';
  const close=()=>{ ov.style.display='none'; };
  document.getElementById('mwPrevX').onclick=close; document.getElementById('mwPrevCancel').onclick=close;
  const img=new Image(); img.style.cssText='max-width:100%;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,.15)';
  img.onload=()=>{ const bd=document.getElementById('mwPrevBody'); bd.innerHTML=''; bd.appendChild(img); };
  img.onerror=()=>{ document.getElementById('mwPrevBody').innerHTML='<span style="color:#ef4444">خطا در بارگذاری پیش‌نمایش</span>'; };
  img.src=imgUrl;
  document.getElementById('mwPrevPrint').onclick=async()=>{ const btn=document.getElementById('mwPrevPrint'); btn.disabled=true; try{ await onConfirm(); close(); }catch(e){ toast(e.message,'err'); btn.disabled=false; } };
}

/* ---------- آپدیت لایو ---------- */
function live(fn, ms=15000){ fn(); const id=setInterval(()=>{ if(!document.hidden) fn(); }, ms); return id; }
