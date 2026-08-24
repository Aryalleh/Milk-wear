// ساخت HTML خودبسندهٔ سند برای چاپ حرارتی ۸۰م‌م — همان طراحیِ فاکتور/بارنامه، سیاه‌سفید
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// فونت وزیرمتن به‌صورت base64 (یک‌بار خوانده و کش می‌شود) تا رندر آفلاین کار کند
let _fontB64 = null;
function fontB64() {
  if (_fontB64 === null) {
    try {
      const p = path.join(__dirname, '../assets/fonts/Vazirmatn.ttf');
      _fontB64 = fs.readFileSync(p).toString('base64');
    } catch { _fontB64 = ''; }
  }
  return _fontB64;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n) => Number(n || 0).toLocaleString('fa-IR');
const fdig = (s) => String(s || '').replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);

async function qrSvg(url) {
  if (!url) return '';
  try {
    return await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  } catch { return ''; }
}

function head() {
  const b64 = fontB64();
  const face = b64
    ? `@font-face{font-family:'Vazirmatn';src:url(data:font/ttf;base64,${b64}) format('truetype');font-weight:100 900;}`
    : '';
  return `<meta charset="utf-8"><style>
  ${face}
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{background:#fff;color:#000;}
  body{width:576px;padding:18px 16px;font-family:'Vazirmatn',sans-serif;font-weight:500;-webkit-font-smoothing:none;}
  .doc{width:100%;}
  .center{text-align:center;}
  .brand{font-size:40px;font-weight:800;line-height:1.2;}
  .title{font-size:26px;font-weight:800;margin-top:2px;}
  .sub{font-size:20px;color:#000;margin-top:2px;}
  .hr{border:0;border-top:2px dashed #000;margin:14px 0;}
  .row{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:23px;margin:6px 0;}
  .row .k{font-weight:500;}
  .row .v{font-weight:700;text-align:left;}
  .item{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin:10px 0;}
  .item .nm{font-size:24px;font-weight:800;}
  .item .qt{font-size:19px;margin-top:2px;}
  .item .am{font-size:24px;font-weight:800;white-space:nowrap;}
  .tot{border-top:2px solid #000;margin-top:12px;padding-top:10px;}
  .tot .big{display:flex;justify-content:space-between;align-items:baseline;font-size:28px;font-weight:800;margin-top:6px;}
  .tot .sm{display:flex;justify-content:space-between;font-size:20px;margin:4px 0;}
  .unit{font-size:16px;}
  .qr{text-align:center;margin-top:18px;}
  .qr svg{width:210px;height:210px;}
  .qrcap{font-size:17px;font-weight:700;letter-spacing:2px;margin-top:6px;}
  .foot{border-top:2px dashed #000;margin-top:16px;padding-top:10px;text-align:center;font-size:19px;line-height:1.7;}
  </style>`;
}

// یک قلم (شیر یا کالا)
function itemRow(nm, qtLine, amount, sign) {
  return `<div class="item"><div><div class="nm">${esc(nm)}</div><div class="qt">${qtLine}</div></div>
    <div class="am">${sign || ''}${fmt(amount)}</div></div>`;
}

function footer(branch) {
  const parts = [];
  if (branch?.phone) parts.push(`<div dir="ltr">تلفن: ${fdig(branch.phone)}</div>`);
  if (branch?.address) parts.push(`<div>${esc(branch.address)}</div>`);
  return parts.length ? `<div class="foot">${parts.join('')}</div>` : '';
}

export async function receiptHTML(p) {
  const rows = [];
  if (p.milk) {
    const lbl = p.milk.shift === 'morning' ? 'شیر صبح (دامدار)' : 'شیر شب (دامدار)';
    const qt = `${fmt(p.milk.weight_kg)} کیلوگرم × ${fmt(p.milk.price_per_kg)}` +
      (p.milk.fat_pct != null ? ` | چربی ${fmt(p.milk.fat_pct)}٪` : '');
    rows.push(itemRow(lbl, qt, p.milk.amount, '+'));
  }
  for (const it of (p.items || [])) {
    rows.push(itemRow(it.name, `${fmt(it.qty)} ${esc(it.unit || '')} × ${fmt(it.price)}`, it.amount, '−'));
  }
  const qr = await qrSvg(p.qr_url);
  return `<!doctype html><html lang="fa" dir="rtl"><head>${head()}</head><body><div class="doc">
    <div class="center">
      <div class="brand">${esc(p.branch?.name || 'سامانه لبنیات')}</div>
      <div class="title">فاکتور</div>
      <div class="sub">شماره فاکتور: ${esc(p.receipt_no)}</div>
    </div>
    <hr class="hr">
    <div class="row"><span class="k">تاریخ ثبت:</span><span class="v">${esc(p.date_jalali)}</span></div>
    <div class="row"><span class="k">طرف حساب:</span><span class="v">${esc(p.person)}${p.person_code ? ` (${esc(p.person_code)})` : ''}</span></div>
    <hr class="hr">
    ${rows.join('') || '<div class="center sub">قلمی ثبت نشده</div>'}
    <div class="tot">
      <div class="sm"><span>جمع بستانکار (شیر):</span><span>${fmt(p.milk_amount)}</span></div>
      <div class="sm"><span>جمع بدهکار (خرید):</span><span>${fmt(p.purchase_amount)}</span></div>
      <div class="big"><span>خالص فاکتور:</span><span>${fmt(p.net_amount)} <span class="unit">ریال</span></span></div>
    </div>
    ${qr ? `<div class="qr">${qr}<div class="qrcap">اسکن برای مشاهدهٔ فاکتور · MILKWEAR</div></div>` : ''}
    ${footer(p.branch)}
  </div></body></html>`;
}

export async function waybillHTML(p) {
  const rows = (p.items || []).map((it) =>
    itemRow(it.name, `${fmt(it.qty)} ${esc(it.unit || '')} × ${fmt(it.price)}`, it.amount, '')).join('');
  const qr = await qrSvg(p.qr_url);
  return `<!doctype html><html lang="fa" dir="rtl"><head>${head()}</head><body><div class="doc">
    <div class="center">
      <div class="brand">${esc(p.branch?.name || 'سامانه لبنیات')}</div>
      <div class="title">بارنامه</div>
      <div class="sub">شماره: ${esc(p.waybill_no || p.order_no)}</div>
    </div>
    <hr class="hr">
    <div class="row"><span class="k">تاریخ:</span><span class="v">${esc(p.date_jalali)}</span></div>
    <div class="row"><span class="k">تحویل‌گیرنده:</span><span class="v">${esc(p.receiver)}${p.person_code ? ` (${esc(p.person_code)})` : ''}</span></div>
    ${p.mobile ? `<div class="row"><span class="k">تلفن:</span><span class="v" dir="ltr">${fdig(p.mobile)}</span></div>` : ''}
    ${p.destination ? `<div class="row"><span class="k">مقصد تحویل:</span><span class="v">${esc(p.destination)}</span></div>` : ''}
    <div class="row"><span class="k">شماره سفارش:</span><span class="v">${esc(p.order_no)}</span></div>
    <hr class="hr">
    ${rows || '<div class="center sub">قلمی ثبت نشده</div>'}
    <div class="tot"><div class="big"><span>جمع کل:</span><span>${fmt(p.total)} <span class="unit">ریال</span></span></div></div>
    ${qr ? `<div class="qr">${qr}<div class="qrcap">اسکن برای مشاهدهٔ فاکتور · MILKWEAR</div></div>` : ''}
    ${footer(p.branch)}
  </div></body></html>`;
}

export async function testHTML(p) {
  return `<!doctype html><html lang="fa" dir="rtl"><head>${head()}</head><body><div class="doc center">
    <div class="brand">${esc(p.branch?.name || 'لبنیات محمدپور')}</div>
    <div class="title">چاپ آزمایشی</div>
    <hr class="hr">
    <div class="sub" style="font-size:24px;margin:14px 0">${esc(p.message || 'اتصال پرینت‌ایجنت سالم است ✔')}</div>
    <div class="qrcap">MILKWEAR</div>
  </div></body></html>`;
}

export async function docHTML(payload) {
  const doc = payload?.doc;
  if (doc === 'waybill') return waybillHTML(payload);
  if (doc === 'test') return testHTML(payload);
  return receiptHTML(payload);
}
