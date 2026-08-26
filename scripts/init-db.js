// ساخت کاملِ دیتابیس روی پروداکشن: جداول (از db/schema.sql) + دادهٔ پایه + کاربر مدیر.
// امن و idempotent: اگر جداول/داده از قبل باشند، دوباره ساخته نمی‌شوند.
//   پیش‌نیاز: دیتابیس (DB_NAME) از قبل توسط ادمین ساخته شده باشد و کاربرِ DB دسترسی داشته باشد.
//   اجرا:  node scripts/init-db.js
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jalaali from 'jalaali-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const ymJ = () => { const { jy, jm } = jalaali.toJalaali(new Date()); return `${jy}-${String(jm).padStart(2, '0')}`; };

const BRANCH_NAME = process.env.INIT_BRANCH_NAME || 'لبنیات محمدپور';
const ADMIN_USER = process.env.INIT_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.INIT_ADMIN_PASS || 'admin123';
const MILK_PRICE = Number(process.env.INIT_MILK_PRICE || 480000);

async function main() {
  if (!process.env.DB_NAME) { console.error('❌ DB_NAME در .env تنظیم نشده'); process.exit(1); }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });
  console.log(`→ دیتابیس: ${process.env.DB_NAME}`);

  // ۱) جداول — schema.sql با CREATE TABLE IF NOT EXISTS است، پس همیشه امن اجرا می‌شود
  //    (جدول‌های نبوده را می‌سازد، موجودها را رد می‌کند؛ حتی روی دیتابیس نیمه‌ساخته)
  console.log('→ ساخت/بررسی جداول از db/schema.sql …');
  await conn.query(fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8'));
  console.log('  ✔ جداول آماده است');

  // ۲) نقش‌ها و انواع اشخاص (یکتا → IGNORE)
  await conn.query(`INSERT IGNORE INTO roles (name,title,is_system) VALUES
    ('admin','مدیر',1),('accountant','حسابداری',1),('station','مسئول ایستگاه',1),
    ('store','فروشگاه',1),('distribution','مدیر پخش',1),('driver','راننده',1),
    ('farmer','دامدار',1),('customer','مشتری',1)`);
  await conn.query("INSERT IGNORE INTO person_types (`key`,title) VALUES " +
    "('farmer','دامدار'),('customer','مشتری'),('supplier','تامین‌کننده'),('sales_rep','نماینده فروش'),('driver','راننده'),('other','سایر')");

  // ۳) واحدها و دسته‌بندی‌ها (فقط اگر خالی)
  const [[u]] = await conn.query('SELECT COUNT(*) c FROM units');
  if (!u.c) await conn.query("INSERT INTO units (name,symbol) VALUES ('کیلوگرم','kg'),('عدد','عدد'),('لیتر','L'),('بسته','بسته')");
  const [[pc]] = await conn.query('SELECT COUNT(*) c FROM product_categories');
  if (!pc.c) await conn.query("INSERT INTO product_categories (name) VALUES ('لبنیات'),('خوراک دام'),('سوپرمارکت'),('سایر')");

  // ۴) تنظیمات پیش‌فرض
  const setDefault = async (k, v) => {
    const [[e]] = await conn.query("SELECT id FROM settings WHERE scope='global' AND `key`=?", [k]);
    if (!e) await conn.query("INSERT INTO settings (scope,scope_id,`key`,value_json) VALUES ('global',NULL,?,?)", [k, JSON.stringify(v)]);
  };
  await setDefault('order_window_open', '08:00');
  await setDefault('order_window_close', '14:00');
  await setDefault('print_mode', 'on_close');
  await setDefault('print_interval_min', 10);
  await setDefault('accept_orders_outside_window', false);
  await setDefault('silo_capacity_kg', 20000);

  // ۵) شعبه + انبار (اگر هیچ شعبه‌ای نیست)
  let [[br]] = await conn.query('SELECT id FROM branches LIMIT 1');
  if (!br) {
    const [r] = await conn.query("INSERT INTO branches (code,name,type) VALUES ('MAIN',?, 'head')", [BRANCH_NAME]);
    br = { id: r.insertId };
    await conn.query("INSERT INTO warehouses (branch_id,name,type) VALUES (?,?, 'store')", [br.id, 'انبار ' + BRANCH_NAME]);
    console.log(`  ✔ شعبه «${BRANCH_NAME}» + انبار ساخته شد`);
  }

  // ۶) کاربر مدیر
  const [[adm]] = await conn.query('SELECT id FROM users WHERE username=?', [ADMIN_USER]);
  if (!adm) {
    const [[role]] = await conn.query("SELECT id FROM roles WHERE name='admin'");
    await conn.query('INSERT INTO users (branch_id,fullname,username,password_hash,role_id) VALUES (?,?,?,?,?)',
      [br.id, 'مدیر سیستم', ADMIN_USER, bcrypt.hashSync(ADMIN_PASS, 10), role.id]);
    console.log(`  ✔ کاربر مدیر ساخته شد — ${ADMIN_USER} / ${ADMIN_PASS}`);
  }

  // ۷) کالای پایهٔ شیر خام
  const [[rm]] = await conn.query("SELECT id FROM products WHERE code='MILK-RAW'");
  if (!rm) {
    const [[cat]] = await conn.query("SELECT id FROM product_categories WHERE name LIKE '%لبنی%' LIMIT 1");
    const [[kg]] = await conn.query("SELECT id FROM units WHERE symbol='kg' LIMIT 1");
    await conn.query("INSERT INTO products (code,name,category_id,unit_id,base_price,is_raw_milk,track_stock) VALUES ('MILK-RAW','شیر خام',?,?,0,1,0)", [cat?.id || null, kg?.id || null]);
  }

  // ۸) قیمت شیرِ ماه جاری
  const [[mp]] = await conn.query("SELECT id FROM milk_price_history WHERE year_month_jalali=? AND person_id IS NULL", [ymJ()]);
  if (!mp) await conn.query("INSERT INTO milk_price_history (branch_id,year_month_jalali,person_id,price_per_kg) VALUES (?,?,NULL,?)", [br.id, ymJ(), MILK_PRICE]);

  console.log(`\n✅ دیتابیس آماده است. ورود: ${ADMIN_USER} / ${ADMIN_PASS}`);
  await conn.end();
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
