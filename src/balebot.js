// ربات دوطرفهٔ بله: ادمین یک پیام را فوروارد می‌کند، ربات آیدی عددیِ فرستندهٔ اصلی را
// می‌گیرد و می‌پرسد به کدام «مشتری/دامدار/کارمند» متصل شود؛ سپس bale_user_id را ست می‌کند.
// با long-polling کار می‌کند (بدون webhook/دامنه/HTTPS). فقط یک نمونه باید poll کند.
import { pool } from './db.js';
import { getSettings, setSetting } from './print.js';
import { baleGetUpdates, baleSendMessage, baleAnswerCallback } from './bale.js';

const OFFSET_KEY = 'bale_update_offset';   // در جدول settings ذخیره می‌شود تا بعد از ری‌استارت تکراری پردازش نشود
const fmtId = (n) => String(n);

// وضعیت گفتگوی هر ادمین (کلید = آیدی بلهٔ ادمین) — درون‌حافظه‌ای
const state = new Map();

// آیا این آیدی بله، ادمینِ فعال است؟
async function findAdmin(baleId) {
  const [[u]] = await pool.query(
    `SELECT u.id, u.fullname FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.bale_user_id = ? AND u.is_active = 1 AND r.name = 'admin' LIMIT 1`, [baleId]);
  return u || null;
}

// اتصال یک آیدی بله به شخص یا کاربر — یکتا نگه می‌داریم (از بقیه پاک می‌شود)
async function linkBaleId(kind, id, baleId) {
  await pool.query('UPDATE persons SET bale_user_id = NULL WHERE bale_user_id = ?', [baleId]);
  await pool.query('UPDATE users   SET bale_user_id = NULL WHERE bale_user_id = ?', [baleId]);
  if (kind === 'person') {
    await pool.query('UPDATE persons SET bale_user_id = ? WHERE id = ?', [baleId, id]);
    const [[p]] = await pool.query('SELECT fullname, person_code FROM persons WHERE id = ?', [id]);
    return p ? `${p.fullname} (${p.person_code})` : `#${id}`;
  }
  await pool.query('UPDATE users SET bale_user_id = ? WHERE id = ?', [baleId, id]);
  const [[u]] = await pool.query('SELECT fullname, username FROM users WHERE id = ?', [id]);
  return u ? `${u.fullname} (${u.username})` : `#${id}`;
}

// جستجوی نامزدها بر اساس نوع
async function searchCandidates(type, term) {
  const like = `%${(term || '').trim()}%`;
  if (type === 'staff') {
    const [rows] = await pool.query(
      `SELECT id, fullname, username AS code FROM users
        WHERE is_active = 1 AND (fullname LIKE ? OR username LIKE ? OR mobile LIKE ?)
        ORDER BY fullname LIMIT 8`, [like, like, like]);
    return rows.map((r) => ({ kind: 'user', id: r.id, label: `${r.fullname} — ${r.code}` }));
  }
  const key = type === 'farmer' ? 'farmer' : 'customer';
  const [rows] = await pool.query(
    `SELECT p.id, p.fullname, p.person_code AS code FROM persons p
       JOIN person_roles pr ON pr.person_id = p.id
       JOIN person_types  pt ON pt.id = pr.person_type_id
      WHERE pt.\`key\` = ? AND p.deleted_at IS NULL
        AND (p.fullname LIKE ? OR p.person_code LIKE ? OR p.mobile LIKE ?)
      ORDER BY p.fullname LIMIT 8`, [key, like, like, like]);
  return rows.map((r) => ({ kind: 'person', id: r.id, label: `${r.fullname} — ${r.code}` }));
}

const TYPE_TITLE = { customer: 'مشتری', farmer: 'دامدار', staff: 'کارمند' };

// کیبورد انتخاب نوع
function typeKeyboard() {
  return { inline_keyboard: [[
    { text: '🧑‍🌾 دامدار', callback_data: 't:farmer' },
    { text: '🛒 مشتری', callback_data: 't:customer' },
    { text: '👤 کارمند', callback_data: 't:staff' },
  ]] };
}

// کیبورد نامزدها
function candidatesKeyboard(cands) {
  return { inline_keyboard: cands.map((c) => [{ text: c.label, callback_data: `pick:${c.kind}:${c.id}` }]) };
}

async function askType(chatId, target) {
  state.set(chatId, { step: 'type', target });
  const uname = target.username ? ` (@${target.username})` : '';
  await baleSendMessage(chatId,
    `کاربرِ فوروارد‌شده:\n👤 ${target.name}${uname}\n🆔 آیدی عددی: ${fmtId(target.baleId)}\n\nبه کدام مورد متصل شود؟`,
    typeKeyboard());
}

// پردازش یک پیام متنی/فورواردی
async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  const fromId = msg.from?.id;
  if (!chatId || !fromId) return;
  const text = (msg.text || '').trim();

  // آیدی خودت — برای همه (برای راه‌اندازیِ اولیهٔ ادمین لازم است)
  if (text === '/id' || text === 'آیدی') {
    await baleSendMessage(chatId, `🆔 آیدی عددیِ شما: ${fmtId(fromId)}`);
    return;
  }

  const admin = await findAdmin(fromId);
  if (!admin) return;   // بقیهٔ قابلیت‌ها فقط برای ادمین

  // دستورها
  if (text === '/start' || text === '/help' || text === 'راهنما') {
    await baleSendMessage(chatId,
      'برای اتصالِ یک کاربرِ بله به مشتری/دامدار/کارمند:\n' +
      '۱) یک پیام از آن شخص را همین‌جا فوروارد کنید.\n' +
      '۲) نوعش را انتخاب و از فهرست انتخابش کنید.\n\n' +
      'اگر آیدی کاربر مخفی بود، می‌توانید فقط عددِ آیدی را بفرستید.');
    return;
  }

  // پیام فورواردی → استخراج آیدی فرستندهٔ اصلی
  const fwd = msg.forward_from;
  if (fwd && fwd.id) {
    const name = [fwd.first_name, fwd.last_name].filter(Boolean).join(' ') || `کاربر ${fwd.id}`;
    await askType(chatId, { baleId: fwd.id, name, username: fwd.username || null });
    return;
  }
  // فوروارد شده ولی آیدی مخفی است
  if (msg.forward_sender_name || msg.forward_date) {
    await baleSendMessage(chatId,
      `⚠️ این کاربر (${msg.forward_sender_name || 'ناشناس'}) آیدی‌اش را مخفی کرده و از فوروارد قابل استخراج نیست.\n` +
      'راه‌حل: از خودِ کاربر بخواهید یک پیام مستقیم به ربات بفرستد، یا اگر آیدی عددی‌اش را می‌دانید همان عدد را اینجا بفرستید.');
    return;
  }

  // اگر منتظر «عدد آیدی» یا «عبارت جستجو» هستیم
  const st = state.get(chatId);
  // ورودی عددی خالص → به‌عنوان آیدی بله در نظر گرفته می‌شود
  if (/^\d{3,}$/.test(text)) {
    const name = `کاربر ${text}`;
    await askType(chatId, { baleId: Number(text), name, username: null });
    return;
  }

  if (st && st.step === 'search' && text) {
    const cands = await searchCandidates(st.type, text);
    if (!cands.length) { await baleSendMessage(chatId, 'موردی پیدا نشد. عبارت دیگری بفرستید.'); return; }
    st.results = cands;
    await baleSendMessage(chatId, `نتایج «${text}» — یکی را انتخاب کنید:`, candidatesKeyboard(cands));
    return;
  }

  // پیام نامرتبط
  await baleSendMessage(chatId, 'یک پیام از شخص موردنظر را فوروارد کنید، یا /help را بزنید.');
}

// پردازش کلیک روی دکمهٔ شیشه‌ای
async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const fromId = cb.from?.id;
  const data = cb.data || '';
  if (!chatId || !fromId) return;
  const admin = await findAdmin(fromId);
  if (!admin) { await baleAnswerCallback(cb.id, 'مجاز نیستید'); return; }

  const st = state.get(chatId);
  if (data.startsWith('t:')) {
    if (!st || !st.target) { await baleAnswerCallback(cb.id, 'ابتدا یک پیام فوروارد کنید'); return; }
    const type = data.slice(2);
    st.step = 'search'; st.type = type;
    await baleAnswerCallback(cb.id, TYPE_TITLE[type] || '');
    const cands = await searchCandidates(type, '');
    const head = `نوع: ${TYPE_TITLE[type]} — نامِ ${TYPE_TITLE[type]} یا کد را بفرستید تا جستجو کنم` +
      (cands.length ? '\nیا از فهرست زیر انتخاب کنید:' : '');
    await baleSendMessage(chatId, head, cands.length ? candidatesKeyboard(cands) : undefined);
    return;
  }

  if (data.startsWith('pick:')) {
    if (!st || !st.target) { await baleAnswerCallback(cb.id, 'منقضی شد؛ دوباره فوروارد کنید'); return; }
    const [, kind, idStr] = data.split(':');
    const id = Number(idStr);
    try {
      const label = await linkBaleId(kind, id, st.target.baleId);
      await baleAnswerCallback(cb.id, 'متصل شد ✅');
      await baleSendMessage(chatId,
        `✅ آیدی بله ${fmtId(st.target.baleId)} به «${label}» متصل شد.\n` +
        'از این پس اعلان‌ها/فاکتورها به این کاربر ارسال می‌شود.');
      state.delete(chatId);
    } catch (e) {
      await baleAnswerCallback(cb.id, 'خطا');
      await baleSendMessage(chatId, `❌ اتصال ناموفق: ${e.message}`);
    }
    return;
  }

  await baleAnswerCallback(cb.id, '');
}

async function processUpdate(u) {
  try {
    if (u.message) await handleMessage(u.message);
    else if (u.callback_query) await handleCallback(u.callback_query);
  } catch (e) {
    console.error('balebot update:', e.message);
  }
}

let running = false;
async function loop() {
  if (running) return;
  running = true;
  let offset = 0;
  try {
    const s = await getSettings();
    offset = Number(s[OFFSET_KEY] || 0);
    // در اولین اجرا اگر offset نداریم، بک‌لاگ را رد کن (فقط آخری را مبنا بگیر)
    if (!offset) {
      const init = await baleGetUpdates(-1, 0);
      const last = init?.result?.[init.result.length - 1];
      if (last) { offset = last.update_id + 1; await setSetting(OFFSET_KEY, String(offset)); }
    }
  } catch (e) { console.error('balebot init:', e.message); }

  // حلقهٔ long-poll
  for (;;) {
    try {
      const res = await baleGetUpdates(offset, 30);
      const list = res?.result || [];
      for (const u of list) {
        await processUpdate(u);
        offset = u.update_id + 1;
      }
      if (list.length) await setSetting(OFFSET_KEY, String(offset));
    } catch (e) {
      console.error('balebot poll:', e.message);
      await new Promise((r) => setTimeout(r, 5000));   // مکث کوتاه هنگام خطای شبکه
    }
  }
}

export function startBaleBot() {
  if (!process.env.BALE_BOT_TOKEN) { console.log('balebot: BALE_BOT_TOKEN تنظیم نشده — ربات دوطرفه غیرفعال'); return; }
  loop().catch((e) => console.error('balebot fatal:', e.message));
  console.log('🤖 ربات دوطرفهٔ بله فعال شد (long-polling)');
}
