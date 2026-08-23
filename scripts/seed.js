// کاربر مدیر + چند دادهٔ نمونه برای دموی MVP
import bcrypt from 'bcryptjs';
import { pool, withTx } from '../src/db.js';
import { postTransaction } from '../src/ledger.js';
import { currentJalaliMonth } from '../src/util.js';

async function run() {
  // کاربر مدیر: admin / admin123
  const hash = await bcrypt.hash('admin123', 10);
  await pool.query(
    `INSERT INTO users (branch_id, fullname, username, password_hash, role_id)
     SELECT 1, 'مدیر سیستم', 'admin', ?, id FROM roles WHERE name='admin'
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [hash]
  );
  console.log('✔ کاربر مدیر: admin / admin123');

  // دو دامدار و یک مشتری نمونه
  const persons = [
    { code: 'F001', name: 'حسن دامدار', mobile: '09120000001', role: 'farmer' },
    { code: 'F002', name: 'رضا گله‌دار', mobile: '09120000002', role: 'farmer' },
    { code: 'C001', name: 'فروشگاه پگاه', mobile: '09120000003', role: 'customer' },
  ];
  const ids = {};
  for (const p of persons) {
    const [r] = await pool.query(
      `INSERT INTO persons (person_code, fullname, mobile) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE fullname = VALUES(fullname)`,
      [p.code, p.name, p.mobile]
    );
    const [[row]] = await pool.query('SELECT id FROM persons WHERE person_code = ?', [p.code]);
    ids[p.code] = row.id;
    await pool.query(
      `INSERT IGNORE INTO person_roles (person_id, person_type_id)
       SELECT ?, id FROM person_types WHERE \`key\` = ?`, [row.id, p.role]
    );
  }
  console.log('✔ اشخاص نمونه ساخته شدند');

  // قیمت شیر ماه جاری (تا ثبت شیرِ امروز بدون خطا باشد)
  await pool.query(
    `INSERT INTO milk_price_history (branch_id, year_month_jalali, person_id, price_per_kg)
     VALUES (1, ?, NULL, 38000) ON DUPLICATE KEY UPDATE price_per_kg = VALUES(price_per_kg)`,
    [currentJalaliMonth()]);
  console.log('✔ قیمت شیر ماه جاری ثبت شد');

  // سناریوی نمونه برای «حسن دامدار» — دقیقاً مثل جدول سند
  const month = currentJalaliMonth();
  const hid = ids['F001'];
  await withTx(async (conn) => {
    // شیر صبح (100kg × 38000 = 3,800,000)
    const [d1] = await conn.query(
      `INSERT INTO milk_deliveries (branch_id, person_id, shift, year_month_jalali, weight_kg, price_per_kg, amount)
       VALUES (1,?, 'morning', ?, 100, 38000, 3800000)`, [hid, month]);
    await postTransaction(conn, { personId: hid, txType: 'MILK_DELIVERY', amount: 3800000,
      sourceType: 'milk_delivery', sourceId: d1.insertId, description: 'شیر صبح — ۱۰۰ کیلو', month, branchId: 1 });

    // خوراک دام (بدهکار 1,200,000)
    const [o1] = await conn.query(
      `INSERT INTO orders (branch_id, order_no, person_id, channel, status, total_amount)
       VALUES (1, ?, ?, 'farmer', 'delivered', 1200000)`, [`SO${Date.now()}`, hid]);
    await postTransaction(conn, { personId: hid, txType: 'FEED_SALE', amount: 1200000,
      sourceType: 'order', sourceId: o1.insertId, description: 'خوراک دام', month, branchId: 1 });

    // شیر شب (2,900,000)
    const [d2] = await conn.query(
      `INSERT INTO milk_deliveries (branch_id, person_id, shift, year_month_jalali, weight_kg, price_per_kg, amount)
       VALUES (1,?, 'evening', ?, 76.31, 38000, 2900000)`, [hid, month]);
    await postTransaction(conn, { personId: hid, txType: 'MILK_DELIVERY', amount: 2900000,
      sourceType: 'milk_delivery', sourceId: d2.insertId, description: 'شیر شب', month, branchId: 1 });

    // برداشت نقدی (2,000,000)
    const [pay] = await conn.query(
      `INSERT INTO payments (branch_id, person_id, direction, method, amount, note)
       VALUES (1,?, 'out', 'cash', 2000000, 'برداشت نقدی')`, [hid]);
    await postTransaction(conn, { personId: hid, txType: 'CASH_WITHDRAWAL', amount: 2000000,
      sourceType: 'payment', sourceId: pay.insertId, description: 'برداشت نقدی', month, branchId: 1 });
  });
  console.log('✔ سناریوی نمونهٔ دامدار ثبت شد (مانده باید 3,500,000 باشد)');

  await pool.end();
  console.log('✅ Seed کامل شد.');
}
run().catch((e) => { console.error('❌', e); process.exit(1); });
