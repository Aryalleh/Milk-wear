// ---------- کمک‌ابزار ----------
const $ = (s) => document.querySelector(s);
let TOKEN = localStorage.getItem('token');
let CURRENT = null;      // شخص انتخاب‌شده
let PRODUCTS = [];

const fmt = (n) => Number(n || 0).toLocaleString('fa-IR');
const faDate = (s) => s ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short' }).format(new Date(String(s).replace(' ', 'T'))) : '—';

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'خطا');
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2600);
}

// ---------- ورود ----------
async function doLogin() {
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#lg-user').value, password: $('#lg-pass').value }),
    });
    TOKEN = data.token;
    localStorage.setItem('token', TOKEN);
    localStorage.setItem('who', data.user.fullname);
    enterApp();
  } catch (e) { $('#lg-err').textContent = e.message; }
}

function logout() {
  localStorage.removeItem('token');
  TOKEN = null; location.reload();
}

async function enterApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#who').textContent = localStorage.getItem('who') || '';
  PRODUCTS = await api('/catalog/products');
  loadPersons();
}

// ---------- لیست اشخاص ----------
async function loadPersons() {
  const q = encodeURIComponent($('#q').value || '');
  const rows = await api('/persons?q=' + q);
  const ul = $('#plist');
  ul.innerHTML = rows.map((p) => `
    <li onclick="selectPerson(${p.id})" class="${CURRENT && CURRENT.person.id === p.id ? 'active' : ''}">
      <div class="nm">${p.fullname}
        ${(p.roles || '').split(',').filter(Boolean).map((r) => `<span class="tag">${roleFa(r)}</span>`).join('')}
      </div>
      <div class="meta">${p.person_code} · ${p.mobile || '—'}</div>
    </li>`).join('') || '<li class="meta">موردی نیست</li>';
}

const roleFa = (r) => ({ farmer: 'دامدار', customer: 'مشتری', supplier: 'تأمین‌کننده', driver: 'راننده' }[r] || r);
const statusFa = (s) => ({ creditor: 'بستانکار', debtor: 'بدهکار', settled: 'تسویه' }[s] || s);

// ---------- صفحه شخص (دفتر حساب زنده) ----------
async function selectPerson(id) {
  const detail = await api('/persons/' + id);
  const ledger = await api('/persons/' + id + '/ledger');
  CURRENT = detail;
  renderPerson(detail, ledger);
  loadPersons();
}

function renderPerson(d, ledger) {
  const s = d.summary;
  const isFarmer = d.roles.includes('farmer');
  const bigLabel = s.balance >= 0 ? 'قابل پرداخت به این شخص' : 'بدهی این شخص به شرکت';
  const bigVal = fmt(Math.abs(s.balance));

  $('#main').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <h2 style="margin:0">${d.person.fullname}</h2>
      <span class="status ${s.status}">${statusFa(s.status)}</span>
      <span style="color:var(--muted)">${d.person.person_code} · ${d.person.mobile || ''}</span>
    </div>

    <div class="cards">
      <div class="stat big">
        <div class="lbl">${bigLabel} (ریال)</div>
        <div class="val">${bigVal}</div>
      </div>
      <div class="stat"><div class="lbl">شیر این ماه</div><div class="val">${fmt(s.milk_kg_month)} <small>کیلو</small></div></div>
      <div class="stat"><div class="lbl">ارزش شیر این ماه</div><div class="val">${fmt(s.milk_value_month)}</div></div>
      <div class="stat"><div class="lbl">جمع خرید کالا</div><div class="val">${fmt(s.purchases_total)}</div></div>
      <div class="stat"><div class="lbl">جمع پرداخت‌ها</div><div class="val">${fmt(s.payments_total)}</div></div>
      <div class="stat"><div class="lbl">آخرین پرداخت</div><div class="val" style="font-size:15px">${faDate(s.last_payment_at)}</div></div>
    </div>

    <div class="actions">
      ${isFarmer ? `<button class="btn" onclick="openMilkModal()">＋ ثبت شیر</button>` : ''}
      <button class="btn ghost" onclick="openSaleModal()">＋ فروش کالا</button>
      ${isFarmer
        ? `<button class="btn ghost" onclick="openPayModal('out')">پرداخت به دامدار</button>`
        : `<button class="btn ghost" onclick="openPayModal('in')">دریافت از مشتری</button>`}
    </div>

    <h3>گردش حساب</h3>
    <div class="card" style="padding:0;overflow:auto;max-height:52vh">
      <table>
        <thead><tr><th>تاریخ</th><th>شرح</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th></tr></thead>
        <tbody>
          ${ledger.length ? ledger.slice().reverse().map((r) => `
            <tr>
              <td>${faDate(r.tx_date)}</td>
              <td>${r.description}</td>
              <td class="num debit">${Number(r.debit) ? fmt(r.debit) : '—'}</td>
              <td class="num credit">${Number(r.credit) ? fmt(r.credit) : '—'}</td>
              <td class="num">${fmt(r.running_balance)}</td>
            </tr>`).join('')
            : `<tr><td colspan="5" class="empty">هنوز تراکنشی ثبت نشده</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

// ---------- مودال‌ها ----------
function modal(html) {
  $('#modal-root').innerHTML = `<div class="modal" onclick="if(event.target===this)closeModal()"><div class="card">${html}</div></div>`;
}
function closeModal() { $('#modal-root').innerHTML = ''; }

// شخص جدید
function openPersonModal() {
  modal(`
    <h2>ثبت شخص جدید</h2>
    <div class="field"><label>کد شخص</label><input id="p-code" placeholder="D003"></div>
    <div class="field"><label>نام کامل</label><input id="p-name"></div>
    <div class="field"><label>موبایل</label><input id="p-mobile"></div>
    <div class="field"><label>نقش</label>
      <select id="p-role"><option value="farmer">دامدار</option><option value="customer">مشتری</option><option value="supplier">تأمین‌کننده</option></select>
    </div>
    <p class="err" id="p-err"></p>
    <div class="row"><button class="btn ghost" onclick="closeModal()">انصراف</button><button class="btn" onclick="savePerson()">ذخیره</button></div>`);
}
async function savePerson() {
  try {
    const { id } = await api('/persons', { method: 'POST', body: JSON.stringify({
      person_code: $('#p-code').value, fullname: $('#p-name').value,
      mobile: $('#p-mobile').value, roles: [$('#p-role').value],
    })});
    closeModal(); toast('شخص ثبت شد'); await loadPersons(); selectPerson(id);
  } catch (e) { $('#p-err').textContent = e.message; }
}

// ثبت شیر
async function openMilkModal() {
  const price = await api('/catalog/milk-price?person_id=' + CURRENT.person.id);
  modal(`
    <h2>ثبت تحویل شیر</h2>
    <p style="color:var(--muted)">قیمت این ماه: <b>${price.price_per_kg ? fmt(price.price_per_kg) + ' ریال/کیلو' : 'تعیین نشده!'}</b></p>
    <div class="field"><label>نوبت</label><select id="m-shift"><option value="morning">صبح</option><option value="evening">شب</option></select></div>
    <div class="field"><label>وزن (کیلوگرم)</label><input id="m-weight" type="number" step="0.1"></div>
    <p class="err" id="m-err"></p>
    <div class="row"><button class="btn ghost" onclick="closeModal()">انصراف</button><button class="btn" onclick="saveMilk()">ثبت</button></div>`);
}
async function saveMilk() {
  try {
    await api('/milk', { method: 'POST', body: JSON.stringify({
      person_id: CURRENT.person.id, shift: $('#m-shift').value, weight_kg: $('#m-weight').value,
    })});
    closeModal(); toast('شیر ثبت شد'); selectPerson(CURRENT.person.id);
  } catch (e) { $('#m-err').textContent = e.message; }
}

// فروش کالا
function openSaleModal() {
  const opts = PRODUCTS.map((p) => `<option value="${p.id}" data-price="${p.base_price}">${p.name} (${fmt(p.base_price)})</option>`).join('');
  const channel = CURRENT.roles.includes('farmer') ? 'farmer' : 'store';
  modal(`
    <h2>فروش کالا</h2>
    <div class="field"><label>کالا</label><select id="s-prod" onchange="syncPrice()">${opts}</select></div>
    <div class="row">
      <div class="field"><label>تعداد</label><input id="s-qty" type="number" step="0.1" value="1" oninput="calcSale()"></div>
      <div class="field"><label>قیمت واحد</label><input id="s-price" type="number" oninput="calcSale()"></div>
    </div>
    <p>جمع: <b id="s-total">۰</b> ریال</p>
    <input type="hidden" id="s-channel" value="${channel}">
    <p class="err" id="s-err"></p>
    <div class="row"><button class="btn ghost" onclick="closeModal()">انصراف</button><button class="btn" onclick="saveSale()">ثبت فروش</button></div>`);
  syncPrice();
}
function syncPrice() {
  const opt = $('#s-prod').selectedOptions[0];
  $('#s-price').value = opt ? opt.dataset.price : 0;
  calcSale();
}
function calcSale() {
  const t = Math.round((Number($('#s-qty').value) || 0) * (Number($('#s-price').value) || 0));
  $('#s-total').textContent = fmt(t);
}
async function saveSale() {
  try {
    await api('/sales', { method: 'POST', body: JSON.stringify({
      person_id: CURRENT.person.id, channel: $('#s-channel').value,
      items: [{ product_id: Number($('#s-prod').value), quantity: $('#s-qty').value, unit_price: $('#s-price').value }],
    })});
    closeModal(); toast('فروش ثبت شد'); selectPerson(CURRENT.person.id);
  } catch (e) { $('#s-err').textContent = e.message; }
}

// پرداخت / تسویه
function openPayModal(direction) {
  const s = CURRENT.summary;
  const suggest = direction === 'out' ? s.payable_now : s.receivable_now;
  modal(`
    <h2>${direction === 'out' ? 'پرداخت به دامدار' : 'دریافت از مشتری'}</h2>
    <p style="color:var(--muted)">${direction === 'out' ? 'قابل پرداخت' : 'قابل دریافت'}: <b>${fmt(suggest)}</b> ریال</p>
    <div class="field"><label>مبلغ</label><input id="pay-amt" type="number" value="${suggest || ''}"></div>
    <div class="field"><label>روش</label><select id="pay-method">
      <option value="cash">نقد</option><option value="card">کارت</option><option value="transfer">واریز</option></select></div>
    <p class="err" id="pay-err"></p>
    <div class="row">
      <button class="btn ghost" onclick="closeModal()">انصراف</button>
      <button class="btn" onclick="savePay('${direction}')">ثبت</button>
    </div>`);
}
async function savePay(direction) {
  try {
    await api('/payments', { method: 'POST', body: JSON.stringify({
      person_id: CURRENT.person.id, direction, amount: $('#pay-amt').value, method: $('#pay-method').value,
    })});
    closeModal(); toast('پرداخت ثبت شد'); selectPerson(CURRENT.person.id);
  } catch (e) { $('#pay-err').textContent = e.message; }
}

// ---------- شروع ----------
if (TOKEN) enterApp(); else $('#login').classList.remove('hidden');
$('#lg-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
