// ترمیمِ داده: برای تراکنش‌های MILK_DELIVERY که رکوردِ milk_deliveries ندارند،
// رکوردِ «تحویل شیر» می‌سازد تا شیرهای قدیمی در «دریافت شیر ماهانه» هم دیده شوند
// (و چون از گردش حساب فیلتر می‌شوند، دیگر آنجا تکرار نمی‌شوند).
//
// امن و idempotent: فقط تراکنش‌های بی‌رکورد را می‌سازد؛ اجرای دوباره کاری نمی‌کند.
//   اجرا:  node scripts/backfill-milk-deliveries.js
import 'dotenv/config';
import mysql from 'mysql2/promise';

const faToLatin = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

// از توضیحِ تراکنش وزن/قیمت را درمی‌آورد: «شیر صبح — 45.5 کیلو × ۳۲۰٬۰۰۰»
function parseDesc(desc) {
  const d = String(desc || '');
  const shift = d.includes('صبح') ? 'morning' : (d.includes('شب') ? 'evening' : 'morning');
  let weight = null, price = null;
  const w = d.match(/([\d.]+)\s*کیلو/);
  if (w) weight = Number(w[1]);
  const p = d.match(/×\s*([۰-۹0-9٬،,.\s]+)/);
  if (p) { const n = Number(faToLatin(p[1]).replace(/[^\d.]/g, '')); if (n > 0) price = n; }
  return { shift, weight, price };
}

async function main() {
  if (!process.env.DB_NAME) { console.error('❌ DB_NAME در .env تنظیم نشده'); process.exit(1); }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [orphans] = await conn.query(
    `SELECT t.* FROM transactions t
       LEFT JOIN milk_deliveries m ON m.id = t.source_id
      WHERE t.tx_type = 'MILK_DELIVERY' AND t.status = 'active' AND m.id IS NULL
      ORDER BY t.id`);
  console.log(`→ تراکنش‌های شیرِ بی‌رکورد: ${orphans.length}`);
  if (!orphans.length) { console.log('✅ چیزی برای ترمیم نیست.'); await conn.end(); return; }

  let fixed = 0;
  for (const t of orphans) {
    const amount = Number(t.amount);
    let { shift, weight, price } = parseDesc(t.description);

    // اگر قیمت از توضیح درنیامد، از تاریخچهٔ قیمتِ همان ماه بگیر
    if (price == null) {
      const [[pr]] = await conn.query(
        `SELECT price_per_kg FROM milk_price_history
          WHERE year_month_jalali = ? AND (person_id = ? OR person_id IS NULL)
          ORDER BY person_id IS NULL ASC LIMIT 1`, [t.year_month_jalali, t.person_id]);
      if (pr) price = Number(pr.price_per_kg);
    }
    if ((weight == null || !(weight > 0)) && price > 0) weight = Math.round((amount / price) * 1000) / 1000;
    if (!(price > 0)) { price = amount; weight = weight && weight > 0 ? weight : 1; } // آخرین فال‌بک

    const [r] = await conn.query(
      `INSERT INTO milk_deliveries
         (branch_id, person_id, shift, delivered_at, year_month_jalali, weight_kg, price_per_kg, amount, note, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [t.branch_id, t.person_id, shift, t.tx_date, t.year_month_jalali,
       weight, price, amount, 'ترمیم از تراکنش', t.created_by]);
    // تراکنش را به رکوردِ جدید وصل کن تا دوباره یتیم به‌حساب نیاید
    await conn.query('UPDATE transactions SET source_type = ?, source_id = ? WHERE id = ?',
      ['milk_delivery', r.insertId, t.id]);
    fixed++;
  }
  console.log(`✅ ${fixed} رکوردِ «تحویل شیر» ساخته شد.`);
  await conn.end();
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
