// کارهای زمان‌بندی‌شده: بک‌آپ شبانهٔ دیتابیس + گزارش روزانه در بله
import cron from 'node-cron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import { baleSendDocument, baleSendMessage } from './bale.js';
import { toJalaliDate, currentJalaliMonth } from './util.js';

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

export function startCron() {
  // هر شب ساعت ۰۲:۰۰ بک‌آپ
  cron.schedule('0 2 * * *', runBackup);
  // هر روز ساعت ۰۷:۰۰ گزارش روزانه
  cron.schedule('0 7 * * *', runDailyReport);
  console.log('⏰ کرون فعال شد: بک‌آپ ۰۲:۰۰، گزارش روزانه ۰۷:۰۰');
}
