// تمیزکردنِ «دریافتِ یتیم» = تراکنشِ PAYMENT_IN با شرح «دریافت هنگام فروش/تحویل»
// که هیچ فروشِ متناظری در همان لحظه ندارد (ناشی از حذفِ سفارشِ مربوطه).
// این‌ها را باطل (voided) می‌کند و مانده‌های متأثر را بازمحاسبه می‌کند.
//   اجرا:  node scripts/fix-orphan-payments.js
import 'dotenv/config';
import { pool } from '../src/db.js';
import { recomputeBalance } from '../src/ledger.js';

async function main() {
  // دریافت‌های فروشی که در همان تاریخ‌وزمان، فروشِ متناظر ندارند
  const [orphans] = await pool.query(
    `SELECT p.id, p.person_id, p.amount
       FROM transactions p
      WHERE p.status='active' AND p.tx_type='PAYMENT_IN' AND p.source_type='payment'
        AND (p.description LIKE 'دریافت هنگام فروش%' OR p.description LIKE 'دریافت هنگام تحویل%')
        AND NOT EXISTS (
          SELECT 1 FROM transactions s
           WHERE s.person_id = p.person_id AND s.status='active'
             AND s.tx_type IN ('PRODUCT_SALE','FEED_SALE')
             AND ABS(TIMESTAMPDIFF(SECOND, s.tx_date, p.tx_date)) <= 5)`);

  if (!orphans.length) { console.log('✅ دریافتِ یتیمی یافت نشد.'); await pool.end(); return; }

  console.log(`→ ${orphans.length} دریافتِ یتیم یافت شد:`);
  for (const o of orphans) console.log(`   tx#${o.id} | شخص ${o.person_id} | ${Number(o.amount).toLocaleString('fa-IR')} ریال`);

  const ids = orphans.map((o) => o.id);
  await pool.query(`UPDATE transactions SET status='voided' WHERE id IN (${ids.map(() => '?').join(',')})`, ids);

  const persons = [...new Set(orphans.map((o) => o.person_id))];
  for (const pid of persons) await recomputeBalance(pool, pid);
  console.log(`✅ ${ids.length} تراکنش باطل شد و مانده‌ی ${persons.length} شخص بازمحاسبه شد.`);
  await pool.end();
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
