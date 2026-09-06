// کارهای زمان‌بندی‌شده: بک‌آپ شبانهٔ دیتابیس + گزارش روزانه در بله
import cron from 'node-cron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import { baleSendDocument, baleSendMessage } from './bale.js';
import { toJalaliDate, currentJalaliMonth } from './util.js';
import { printTick } from './print.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, '../backups');

const fmt = (n) => Number(n || 0).toLocaleString('fa-IR');

async function baleUsers(roles) {
  const [rows] = await pool.query(
    `SELECT u.bale_user_id, u.fullname FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.name IN (${roles.map(() => '?').join(',')}) AND u.bale_user_id IS NOT NULL AND u.is_active = 1`, roles);
  return rows;
}

// ---- بک‌آپ دیتابیس ----
export function makeBackup() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const file = path.join(BACKUP_DIR, `backup-${ts}.sql`);
    const out = fs.createWriteStream(file);
    const args = ['-h', process.env.DB_HOST || '127.0.0.1', '-P', String(process.env.DB_PORT || 3306),
      '-u', process.env.DB_USER || 'root', process.env.DB_NAME || 'milk_wear'];
    const child = spawn('mysqldump', args, { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' } });
    child.stdout.pipe(out);
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => { code === 0 ? resolve(file) : reject(new Error(err || ('mysqldump exit ' + code))); });
    child.on('error', reject);
  });
}

export async function runBackup() {
  try {
    const file = await makeBackup();
    const buf = fs.readFileSync(file);
    const admins = await baleUsers(['admin']);
    for (const a of admins) {
      await baleSendDocument(a.bale_user_id, buf, path.basename(file), `🗄 بک‌آپ دیتابیس — ${toJalaliDate(new Date())}`);
    }
    console.log(`✔ بک‌آپ ساخته شد: ${path.basename(file)} و برای ${admins.length} مدیر ارسال شد`);
    return { ok: true, file };
  } catch (e) {
    console.error('❌ بک‌آپ ناموفق:', e.message);
    return { ok: false, error: e.message };
  }
}

// ---- گزارش روزانه ----
export async function buildDailyText() {
  const [[m]] = await pool.query(
    `SELECT COALESCE(SUM(weight_kg),0) kg, COALESCE(SUM(amount),0) val, COUNT(DISTINCT person_id) farmers
       FROM milk_deliveries WHERE DATE(delivered_at)=CURDATE() AND deleted_at IS NULL`);
  const [[s]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN tx_type IN ('PRODUCT_SALE','FEED_SALE') THEN amount END),0) sales,
            COALESCE(SUM(CASE WHEN tx_type='PAYMENT_IN' THEN amount END),0) recv,
            COALESCE(SUM(CASE WHEN tx_type IN ('PAYMENT_OUT','CASH_WITHDRAWAL') THEN amount END),0) paid
       FROM transactions WHERE DATE(tx_date)=CURDATE() AND status='active'`);
  const [[acc]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN current_balance>0 THEN current_balance ELSE 0 END),0) payable,
            COALESCE(SUM(CASE WHEN current_balance<0 THEN -current_balance ELSE 0 END),0) receivable FROM account_balances`);
  return [
    `📊 گزارش روزانهٔ لبنیات — ${toJalaliDate(new Date())}`,
    `🥛 شیر امروز: ${fmt(m.kg)} کیلو (${fmt(m.val)} ریال) از ${fmt(m.farmers)} دامدار`,
    `🛒 فروش امروز: ${fmt(s.sales)} ریال`,
    `💵 دریافت از مشتری: ${fmt(s.recv)} | پرداخت/علی‌الحساب: ${fmt(s.paid)}`,
    `💰 طلب از مشتریان: ${fmt(acc.receivable)} | بدهی به دامداران: ${fmt(acc.payable)}`,
  ].join('\n');
}

export async function runDailyReport() {
  const text = await buildDailyText();
  const managers = await baleUsers(['admin', 'accountant', 'distribution']);
  for (const mgr of managers) await baleSendMessage(mgr.bale_user_id, text);
  console.log(`✔ گزارش روزانه برای ${managers.length} مدیر ارسال شد`);
  return { ok: true, managers: managers.length };
}

// ---- گزارش شبانه (۱۲ شب): ریز خرید/فروش امروز + طلب/بستانکاری هر دامدار و مشتری ----
export async function buildNightlyText() {
  const today = toJalaliDate(new Date());
  const [[s]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN tx_type IN ('PRODUCT_SALE','FEED_SALE') THEN amount END),0) sales,
            COALESCE(SUM(CASE WHEN tx_type IN ('MILK_DELIVERY','PURCHASE','GOODS_IN') THEN amount END),0) purchases,
            COALESCE(SUM(CASE WHEN tx_type='PAYMENT_IN' THEN amount END),0) recv,
            COALESCE(SUM(CASE WHEN tx_type IN ('PAYMENT_OUT','CASH_WITHDRAWAL') THEN amount END),0) paid
       FROM transactions WHERE DATE(tx_date)=CURDATE() AND status='active'`);
  // ریز تراکنش‌های امروز
  const [rows] = await pool.query(
    `SELECT p.fullname, t.tx_type, t.amount
       FROM transactions t JOIN persons p ON p.id=t.person_id
      WHERE DATE(t.tx_date)=CURDATE() AND t.status='active'
        AND t.tx_type IN ('PRODUCT_SALE','FEED_SALE','MILK_DELIVERY','PURCHASE','GOODS_IN','PAYMENT_IN','PAYMENT_OUT','CASH_WITHDRAWAL')
      ORDER BY t.id`);
  const TL = { PRODUCT_SALE: 'فروش', FEED_SALE: 'فروش خوراک', MILK_DELIVERY: 'شیر', PURCHASE: 'خرید', GOODS_IN: 'دریافت کالا', PAYMENT_IN: 'دریافت', PAYMENT_OUT: 'پرداخت', CASH_WITHDRAWAL: 'برداشت' };
  // مانده‌ها به تفکیک دامدار/مشتری (فقط ناصفر)
  const [bals] = await pool.query(
    `SELECT p.fullname, ab.current_balance,
            MAX(CASE WHEN pt.\`key\`='farmer' THEN 1 ELSE 0 END) is_farmer
       FROM account_balances ab JOIN persons p ON p.id=ab.person_id
       LEFT JOIN person_roles pr ON pr.person_id=p.id
       LEFT JOIN person_types pt ON pt.id=pr.person_type_id
      WHERE ab.current_balance <> 0
      GROUP BY p.id ORDER BY is_farmer DESC, ABS(ab.current_balance) DESC`);

  const lines = [];
  lines.push(`🌙 گزارش شبانه — ${today}`);
  lines.push(`🛒 فروش: ${fmt(s.sales)} | 🥛 خرید: ${fmt(s.purchases)}`);
  lines.push(`💵 دریافت: ${fmt(s.recv)} | 💸 پرداخت: ${fmt(s.paid)}`);
  lines.push('');
  lines.push('— ریز امروز —');
  if (rows.length) for (const r of rows) lines.push(`• ${r.fullname}: ${TL[r.tx_type] || r.tx_type} ${fmt(r.amount)}`);
  else lines.push('تراکنشی نبود');
  const farmers = bals.filter((b) => b.is_farmer), customers = bals.filter((b) => !b.is_farmer);
  lines.push('');
  lines.push('— دامداران (+ بستانکار = طلب او از ما) —');
  if (farmers.length) for (const b of farmers) lines.push(`• ${b.fullname}: ${Number(b.current_balance) > 0 ? 'بستانکار ' : 'بدهکار '}${fmt(Math.abs(b.current_balance))}`);
  else lines.push('—');
  lines.push('');
  lines.push('— مشتریان (− بدهکار = بدهی او به ما) —');
  if (customers.length) for (const b of customers) lines.push(`• ${b.fullname}: ${Number(b.current_balance) < 0 ? 'بدهکار ' : 'بستانکار '}${fmt(Math.abs(b.current_balance))}`);
  else lines.push('—');
  return lines.join('\n');
}

export async function runNightlyReport() {
  const text = await buildNightlyText();
  const admins = await baleUsers(['admin']);
  for (const a of admins) {
    if (text.length > 3800) {
      await baleSendDocument(a.bale_user_id, Buffer.from(text, 'utf8'), `nightly-${toJalaliDate(new Date()).replace(/\//g, '-')}.txt`, '🌙 گزارش شبانه');
    } else {
      await baleSendMessage(a.bale_user_id, text);
    }
  }
  console.log(`✔ گزارش شبانه برای ${admins.length} مدیر ارسال شد`);
  return { ok: true, admins: admins.length };
}

export function startCron() {
  // هر شب ساعت ۱۲ شب گزارش شبانه (ریز خرید/فروش + مانده‌ها)
  cron.schedule('0 0 * * *', runNightlyReport);
  // هر شب ساعت ۰۲:۰۰ بک‌آپ
  cron.schedule('0 2 * * *', runBackup);
  // هر روز ساعت ۰۷:۰۰ گزارش روزانه
  cron.schedule('0 7 * * *', runDailyReport);
  // چاپ خودکار بارنامه لغو شد؛ راننده هنگام بارگیری همه را دستی چاپ می‌کند.
  console.log('⏰ کرون فعال شد: گزارش شبانه ۰۰:۰۰، بک‌آپ ۰۲:۰۰، گزارش ۰۷:۰۰');
}
