// افزودنِ ستون‌ها/تغییراتِ نبوده به دیتابیسِ موجود — امن و idempotent.
// چرا لازم است: schema.sql با CREATE TABLE IF NOT EXISTS ستونِ جدید را به جدولِ
// از-قبل-موجود اضافه نمی‌کند؛ این اسکریپت با بررسیِ information_schema فقط چیزهای
// نبوده را می‌سازد. هر بار قابل اجراست و اگر همه‌چیز باشد، کاری نمی‌کند.
//   اجرا:  node scripts/migrate.js   (یا: npm run db:migrate)
import 'dotenv/config';
import mysql from 'mysql2/promise';

// ستون‌هایی که مهاجرت‌های 013..019 اضافه می‌کنند (جدول، ستون، تعریفِ ALTER)
const COLUMNS = [
  ['orders', 'fulfillment_type', "ADD COLUMN fulfillment_type ENUM('pickup','delivery') NOT NULL DEFAULT 'delivery' AFTER channel"],
  ['orders', 'paid_amount', 'ADD COLUMN paid_amount DECIMAL(18,0) NOT NULL DEFAULT 0 AFTER total_amount'],
  ['orders', 'no_packaging', 'ADD COLUMN no_packaging TINYINT(1) NOT NULL DEFAULT 0 AFTER fulfillment_type'],
  ['products', 'packaging_id', 'ADD COLUMN packaging_id BIGINT NULL AFTER unit_id'],
  ['products', 'packaging_per_unit', 'ADD COLUMN packaging_per_unit DECIMAL(10,3) NOT NULL DEFAULT 1 AFTER packaging_id'],
  ['products', 'packaging_capacity', 'ADD COLUMN packaging_capacity DECIMAL(10,3) NOT NULL DEFAULT 1 AFTER packaging_per_unit'],
  ['order_items', 'packaging_qty', 'ADD COLUMN packaging_qty DECIMAL(14,3) NOT NULL DEFAULT 0'],
  ['order_items', 'packaging_cost', 'ADD COLUMN packaging_cost DECIMAL(18,0) NOT NULL DEFAULT 0'],
  ['packagings', 'margin_pct', 'ADD COLUMN margin_pct DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER default_price'],
];

// تغییرِ نوعِ ENUM — اجرای دوبارهٔ MODIFY امن است (idempotent)
const MODIFIES = [
  ["print_jobs", "MODIFY kind ENUM('waybill','receipt','statement','manifest','test') NOT NULL"],
  ["transactions", "MODIFY tx_type ENUM('MILK_DELIVERY','PRODUCT_SALE','FEED_SALE','CASH_WITHDRAWAL','PAYMENT_OUT','PAYMENT_IN','ADJUSTMENT','REFUND','OPENING_BALANCE','VOID','PURCHASE','GOODS_IN') NOT NULL"],
];

async function main() {
  if (!process.env.DB_NAME) { console.error('❌ DB_NAME در .env تنظیم نشده'); process.exit(1); }
  const db = process.env.DB_NAME;
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: db,
  });
  console.log(`→ دیتابیس: ${db}`);

  const tableExists = async (t) => {
    const [[r]] = await conn.query(
      'SELECT COUNT(*) c FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [db, t]);
    return r.c > 0;
  };
  const columnExists = async (t, c) => {
    const [[r]] = await conn.query(
      'SELECT COUNT(*) c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [db, t, c]);
    return r.c > 0;
  };

  let added = 0;
  for (const [table, col, ddl] of COLUMNS) {
    if (!(await tableExists(table))) { console.log(`  ⏭  جدول ${table} نیست (اول npm run db:init) — رد شد`); continue; }
    if (await columnExists(table, col)) { console.log(`  ✔ ${table}.${col} از قبل هست`); continue; }
    await conn.query(`ALTER TABLE \`${table}\` ${ddl}`);
    console.log(`  ➕ افزوده شد: ${table}.${col}`);
    added++;
  }

  for (const [table, ddl] of MODIFIES) {
    if (!(await tableExists(table))) continue;
    try { await conn.query(`ALTER TABLE \`${table}\` ${ddl}`); console.log(`  ✔ نوعِ ${table} به‌روز شد`); }
    catch (e) { console.log(`  ⚠ ${table}: ${e.message}`); }
  }

  console.log(added ? `\n✅ ${added} ستون افزوده شد.` : '\n✅ همه‌چیز از قبل به‌روز بود.');
  await conn.end();
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
