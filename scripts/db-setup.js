// اجرای اسکیما + درج داده‌های پایه و چند نمونه برای تست MVP
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function currentJalaliYearMonth() {
  // ماه شمسی جاری با Intl
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  return `${y}-${m}`;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  console.log('→ اجرای اسکیما...');
  const schema = fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8');
  await conn.query(schema);

  console.log('→ درج نقش‌ها...');
  await conn.query(
    `INSERT INTO roles (key_name, title) VALUES
      ('admin','مدیر'), ('accountant','حسابداری'), ('station','مسئول ایستگاه'),
      ('store','فروشگاه'), ('driver','راننده'), ('distribution','مدیر پخش')`
  );

  console.log('→ درج شعبه و کاربر مدیر...');
  await conn.query(
    `INSERT INTO branches (code, name, type) VALUES ('MAIN','دفتر مرکزی','head')`
  );
  const adminHash = await bcrypt.hash('admin123', 10);
  await conn.query(
    `INSERT INTO users (branch_id, fullname, username, password_hash, role_id)
     VALUES (1, 'مدیر سیستم', 'admin', ?, (SELECT id FROM roles WHERE key_name='admin'))`,
    [adminHash]
  );

  console.log('→ درج دسته‌ها و کالاها...');
  await conn.query(
    `INSERT INTO product_categories (name) VALUES ('لبنیات'),('خوراک دام'),('سوپرمارکت')`
  );
  await conn.query(
    `INSERT INTO products (code, name, category_id, unit, base_price) VALUES
      ('P001','ماست', 1, 'کیلوگرم', 450000),
      ('P002','پنیر', 1, 'کیلوگرم', 1200000),
      ('P003','خوراک دام کنسانتره', 2, 'کیسه', 3800000),
      ('P004','تخم مرغ شانه‌ای', 3, 'شانه', 950000)`
  );

  console.log('→ درج نمونه اشخاص...');
  await conn.query(
    `INSERT INTO persons (person_code, fullname, mobile) VALUES
      ('D001','حسن دامدار', '09120000001'),
      ('D002','رضا گاوداری', '09120000002'),
      ('C001','فروشگاه میلاد', '09120000003')`
  );
  await conn.query(
    `INSERT INTO person_roles (person_id, role_type) VALUES
      (1,'farmer'), (2,'farmer'), (3,'customer')`
  );

  const ym = currentJalaliYearMonth();
  console.log(`→ درج قیمت عمومی شیر برای ماه ${ym}...`);
  await conn.query(
    `INSERT INTO milk_prices (period_ym, person_id, price_per_kg) VALUES (?, NULL, 380000)`,
    [ym]
  );

  await conn.end();
  console.log('\n✓ راه‌اندازی کامل شد.');
  console.log('  ورود مدیر →  username: admin   password: admin123');
  console.log(`  قیمت شیر ماه ${ym}: 380,000 ریال/کیلو`);
}

main().catch((e) => {
  console.error('✗ خطا:', e.message);
  process.exit(1);
});
