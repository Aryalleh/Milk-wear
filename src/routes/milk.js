import { Router } from 'express';
import { pool, withTx } from '../db.js';
import { postTransaction, resolveMilkPrice } from '../ledger.js';
import { AppError, wrap, currentJalaliMonth } from '../util.js';

const router = Router();

// ثبت تحویل شیر → می‌سازد تراکنش MILK_DELIVERY (بستانکار دامدار)
router.post('/deliveries', wrap(async (req, res) => {
  const { person_id, shift, weight_kg, price_per_kg, fat_pct, note, branch_id } = req.body;
  if (!person_id || !shift || !weight_kg) throw new AppError(400, 'دامدار، شیفت و وزن لازم است');
  const month = currentJalaliMonth();

  const result = await withTx(async (conn) => {
    // قیمت: اگر دستی داده نشده، از تاریخچهٔ قیمت ماه (اختصاصی یا عمومی) گرفته می‌شود
    let price = price_per_kg;
    if (price == null) price = await resolveMilkPrice(conn, person_id, month);
    if (price == null) throw new AppError(400, `قیمت شیر برای ماه ${month} تعریف نشده است`);

    const amount = Math.round(Number(weight_kg) * Number(price));
    const [r] = await conn.query(
      `INSERT INTO milk_deliveries
         (branch_id, person_id, shift, year_month_jalali, weight_kg, fat_pct, price_per_kg, amount, note, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [branch_id || null, person_id, shift, month, weight_kg, fat_pct || null, price, amount, note || null, req.user?.uid || null]
    );
    const label = shift === 'morning' ? 'شیر صبح' : 'شیر شب';
    await postTransaction(conn, {
      personId: person_id, txType: 'MILK_DELIVERY', amount,
      sourceType: 'milk_delivery', sourceId: r.insertId,
      description: `${label} — ${weight_kg} کیلو × ${Number(price).toLocaleString('fa')}`,
      branchId: branch_id || null, userId: req.user?.uid, month,
    });
    return { id: r.insertId, amount, price };
  });
  res.status(201).json(result);
}));

// لیست تحویل‌های یک دامدار در ماه جاری
router.get('/deliveries', wrap(async (req, res) => {
  const { person_id, month } = req.query;
  const ym = month || currentJalaliMonth();
  const [rows] = await pool.query(
    `SELECT * FROM milk_deliveries
      WHERE person_id = ? AND year_month_jalali = ? AND deleted_at IS NULL
      ORDER BY delivered_at DESC`, [person_id, ym]);
  res.json(rows);
}));

// گزارش کامل ایستگاه شیر — هر دامدار چند لیتر/کیلو داده و هر کیلویش چند بوده
router.get('/report', wrap(async (req, res) => {
  const month = req.query.month || currentJalaliMonth();
  const [rows] = await pool.query(
    `SELECT p.id, p.fullname, p.person_code,
            COUNT(*) AS cnt,
            COALESCE(SUM(md.weight_kg),0) AS kg,
            COALESCE(SUM(md.amount),0) AS value,
            ROUND(SUM(md.amount)/NULLIF(SUM(md.weight_kg),0)) AS avg_price,
            ROUND(AVG(md.fat_pct),2) AS avg_fat
       FROM milk_deliveries md JOIN persons p ON p.id = md.person_id
      WHERE md.year_month_jalali = ? AND md.deleted_at IS NULL
      GROUP BY p.id ORDER BY kg DESC`, [month]);
  const [[tot]] = await pool.query(
    `SELECT COALESCE(SUM(weight_kg),0) kg, COALESCE(SUM(amount),0) value, COUNT(DISTINCT person_id) farmers, COUNT(*) cnt
       FROM milk_deliveries WHERE year_month_jalali = ? AND deleted_at IS NULL`, [month]);
  res.json({
    month,
    total: { kg: Number(tot.kg), value: Number(tot.value), farmers: tot.farmers, count: tot.cnt },
    farmers: rows.map((r) => ({ id: r.id, fullname: r.fullname, person_code: r.person_code,
      count: r.cnt, kg: Number(r.kg), value: Number(r.value),
      avg_price: Number(r.avg_price || 0), avg_fat: r.avg_fat != null ? Number(r.avg_fat) : null })),
  });
}));

// قیمت شیر ماه جاری
router.get('/price', wrap(async (req, res) => {
  const month = req.query.month || currentJalaliMonth();
  const price = await resolveMilkPrice(pool, req.query.person_id || 0, month);
  res.json({ month, price });
}));

// ثبت/به‌روزرسانی قیمت عمومی شیر برای یک ماه
router.post('/price', wrap(async (req, res) => {
  const { year_month_jalali, price_per_kg, person_id, branch_id } = req.body;
  const month = year_month_jalali || currentJalaliMonth();
  if (!price_per_kg) throw new AppError(400, 'قیمت لازم است');
  await pool.query(
    `INSERT INTO milk_price_history (branch_id, year_month_jalali, person_id, price_per_kg, created_by)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE price_per_kg = VALUES(price_per_kg)`,
    [branch_id || null, month, person_id || null, price_per_kg, req.user?.uid || null]
  );
  res.status(201).json({ month, price_per_kg, person_id: person_id || null });
}));

export default router;
