// صف چاپ سمت سرور + عکس‌برداری از اسناد برای پرینت‌ایجنت (ESC/POS 80mm)
import crypto from 'crypto';
import { pool } from './db.js';
import { toJalaliDate } from './util.js';

// ---------- تنظیمات عمومی (کلید/مقدار) ----------
export async function getSettings() {
  const [rows] = await pool.query("SELECT `key`, value_json FROM settings WHERE scope='global'");
  const map = {};
  for (const r of rows) {
    try { map[r.key] = typeof r.value_json === 'string' ? JSON.parse(r.value_json) : r.value_json; }
    catch { map[r.key] = r.value_json; }
  }
  return map;
}

// upsert امن (به یکتاییِ scope_id=NULL تکیه نمی‌کند)
export async function setSetting(key, value) {
  const [r] = await pool.query(
    "UPDATE settings SET value_json = ? WHERE scope='global' AND `key` = ?",
    [JSON.stringify(value), key]);
  if (!r.affectedRows) {
    await pool.query(
      "INSERT INTO settings (scope, scope_id, `key`, value_json) VALUES ('global', NULL, ?, ?)",
      [key, JSON.stringify(value)]);
  }
}

// توکن ایجنت (در صورت نبود، یک‌بار ساخته و ذخیره می‌شود)
export async function getAgentToken() {
  const s = await getSettings();
  if (s.agent_token) return s.agent_token;
  const t = crypto.randomBytes(24).toString('hex');
  await setSetting('agent_token', t);
  return t;
}

function qrUrl(token) {
  if (!token) return null;
  const base = (process.env.APP_PUBLIC_URL || '').replace(/\/+$/, '');
  return base ? `${base}/r/${token}` : `/r/${token}`;
}

// ---------- عکس‌برداری اسناد ----------
export async function buildWaybillPayload(orderId) {
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL', [orderId]);
  if (!order) return null;
  const [[person]] = await pool.query(
    'SELECT person_code, fullname, mobile, address FROM persons WHERE id = ?', [order.person_id]);
  const [[branch]] = await pool.query(
    'SELECT id, name, phone, address FROM branches WHERE id = ?', [order.branch_id]);
  const [items] = await pool.query(
    `SELECT oi.quantity, oi.unit_price, oi.amount, p.name AS product_name, u.symbol AS unit
       FROM order_items oi JOIN products p ON p.id = oi.product_id
       LEFT JOIN units u ON u.id = p.unit_id WHERE oi.order_id = ?`, [orderId]);
  const [[receipt]] = await pool.query(
    'SELECT public_token FROM receipts WHERE order_id = ? ORDER BY id DESC LIMIT 1', [orderId]);
  return {
    branch_id: order.branch_id,
    payload: {
      doc: 'waybill', title: 'بارنامه',
      branch: { name: branch?.name || 'سامانه لبنیات', phone: branch?.phone || '', address: branch?.address || '' },
      order_no: order.order_no,
      waybill_no: order.waybill_no || order.order_no,
      date_jalali: toJalaliDate(order.ordered_at || order.created_at),
      receiver: person?.fullname || '', person_code: person?.person_code || '',
      mobile: person?.mobile || '',
      destination: order.destination || person?.address || '',
      items: items.map((i) => ({
        name: i.product_name, qty: Number(i.quantity), unit: i.unit || '',
        price: Number(i.unit_price), amount: Number(i.amount),
      })),
      total: Number(order.total_amount),
      // QR بارنامه به فاکتورِ همین سفارش اشاره می‌کند
      qr_token: receipt?.public_token || null,
      qr_url: qrUrl(receipt?.public_token),
    },
  };
}

export async function buildReceiptPayload(receiptId) {
  const [[rc]] = await pool.query('SELECT * FROM receipts WHERE id = ?', [receiptId]);
  if (!rc) return null;
  const [[person]] = await pool.query(
    'SELECT person_code, fullname, mobile FROM persons WHERE id = ?', [rc.person_id]);
  const [[branch]] = await pool.query(
    'SELECT id, name, phone, address FROM branches WHERE id = ?', [rc.branch_id]);
  let milk = null;
  if (rc.milk_delivery_id) {
    const [[m]] = await pool.query('SELECT shift, weight_kg, fat_pct, price_per_kg, amount FROM milk_deliveries WHERE id = ?', [rc.milk_delivery_id]);
    if (m) milk = { shift: m.shift, weight_kg: Number(m.weight_kg), fat_pct: m.fat_pct == null ? null : Number(m.fat_pct), price_per_kg: Number(m.price_per_kg), amount: Number(m.amount) };
  }
  let items = [];
  if (rc.order_id) {
    const [rows] = await pool.query(
      `SELECT oi.quantity, oi.unit_price, oi.amount, p.name AS product_name, u.symbol AS unit
         FROM order_items oi JOIN products p ON p.id = oi.product_id
         LEFT JOIN units u ON u.id = p.unit_id WHERE oi.order_id = ?`, [rc.order_id]);
    items = rows.map((i) => ({ name: i.product_name, qty: Number(i.quantity), unit: i.unit || '', price: Number(i.unit_price), amount: Number(i.amount) }));
  }
  return {
    branch_id: rc.branch_id,
    payload: {
      doc: 'receipt', title: 'فاکتور',
      branch: { name: branch?.name || 'سامانه لبنیات', phone: branch?.phone || '', address: branch?.address || '' },
      receipt_no: rc.receipt_no,
      date_jalali: toJalaliDate(rc.issued_at),
      person: person?.fullname || '', person_code: person?.person_code || '', mobile: person?.mobile || '',
      milk, items,
      milk_amount: Number(rc.milk_amount), purchase_amount: Number(rc.purchase_amount),
      net_amount: Number(rc.net_amount), balance_after: Number(rc.balance_after),
      qr_token: rc.public_token || null,
      qr_url: qrUrl(rc.public_token),
    },
  };
}

// ---------- صف چاپ ----------
export async function enqueuePrint({ kind, refType = 'none', refId = null, branchId = null, copies = 1, payload }) {
  const [r] = await pool.query(
    `INSERT INTO print_jobs (branch_id, kind, ref_type, ref_id, copies, payload, status)
     VALUES (?,?,?,?,?,?, 'queued')`,
    [branchId, kind, refType, refId, copies, JSON.stringify(payload)]);
  return r.insertId;
}

export async function enqueueWaybill(orderId, copies = 1) {
  const b = await buildWaybillPayload(orderId);
  if (!b) return null;
  return enqueuePrint({ kind: 'waybill', refType: 'order', refId: orderId, branchId: b.branch_id, copies, payload: b.payload });
}

export async function enqueueReceipt(receiptId, copies = 1) {
  const b = await buildReceiptPayload(receiptId);
  if (!b) return null;
  return enqueuePrint({ kind: 'receipt', refType: 'receipt', refId: receiptId, branchId: b.branch_id, copies, payload: b.payload });
}

// صورتحساب: کوئریِ صفحهٔ statement.html در payload ذخیره می‌شود؛ ایجنت همان صفحه را چاپ می‌کند
export async function enqueueStatement(query, copies = 1) {
  return enqueuePrint({ kind: 'statement', refType: 'none', refId: null, branchId: null, copies, payload: { doc: 'statement', query } });
}

// تیکِ زمان‌بندی: بارنامهٔ سفارش‌های صف‌شده را در ساعت مقرر/بازه‌ای به صف چاپ می‌فرستد
export async function printTick(now = new Date()) {
  const s = await getSettings();
  const mode = s.print_mode || 'on_close';
  const interval = Math.max(1, Number(s.print_interval_min || 10));
  const close = String(s.order_window_close || '14:00');
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  let due = false;
  if ((mode === 'on_close' || mode === 'both') && hhmm === close) due = true;
  if ((mode === 'every_n' || mode === 'both') && now.getMinutes() % interval === 0) due = true;
  if (!due) return { due: false, printed: 0 };

  const [orders] = await pool.query(
    "SELECT id FROM orders WHERE status='queued' AND waybill_queued_at IS NULL AND deleted_at IS NULL ORDER BY id");
  let printed = 0;
  for (const o of orders) {
    const jid = await enqueueWaybill(o.id);
    if (jid) {
      await pool.query("UPDATE orders SET status='confirmed', waybill_queued_at = NOW() WHERE id = ?", [o.id]);
      printed++;
    }
  }
  return { due: true, printed };
}

// اجرای دستیِ دسته (برای دکمهٔ «چاپ همهٔ بارنامه‌های صف» — بی‌توجه به ساعت)
export async function runBatchNow() {
  const [orders] = await pool.query(
    "SELECT id FROM orders WHERE status='queued' AND waybill_queued_at IS NULL AND deleted_at IS NULL ORDER BY id");
  let printed = 0;
  for (const o of orders) {
    const jid = await enqueueWaybill(o.id);
    if (jid) { await pool.query("UPDATE orders SET status='confirmed', waybill_queued_at = NOW() WHERE id = ?", [o.id]); printed++; }
  }
  return printed;
}

// آیا اکنون در بازهٔ سفارش‌گیری هستیم؟
export function withinOrderWindow(settings, now = new Date()) {
  const open = String(settings.order_window_open || '00:00');
  const close = String(settings.order_window_close || '23:59');
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return hhmm >= open && hhmm <= close;
}
