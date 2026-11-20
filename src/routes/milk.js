import { Router } from 'express';
import { pool, withTx } from '../db.js';
import { postTransaction, resolveMilkPrice, recomputeBalance, voidTransactionsBySource } from '../ledger.js';
import { assertDayOpen, recordDay } from '../dayclose.js';
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

// ویرایش تحویل شیر (مستقیم) — فقط تا قبل از «بستن روز». تراکنشِ مرتبط هم‌زمان اصلاح می‌شود.
router.put('/deliveries/:id', wrap(async (req, res) => {
  const id = req.params.id;
  const { shift, weight_kg, price_per_kg, fat_pct, note } = req.body;

  await withTx(async (conn) => {
    const [[md]] = await conn.query('SELECT * FROM milk_deliveries WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!md) throw new AppError(404, 'تحویل شیر یافت نشد');
    const day = await recordDay(conn, 'milk_deliveries', 'delivered_at', id);
    await assertDayOpen(conn, day, md.branch_id);

    const newShift = shift || md.shift;
    const newWeight = weight_kg != null ? Number(weight_kg) : Number(md.weight_kg);
    const newPrice = price_per_kg != null ? Number(price_per_kg) : Number(md.price_per_kg);
    if (!(newWeight > 0) || !(newPrice > 0)) throw new AppError(400, 'وزن و قیمت باید بزرگ‌تر از صفر باشد');
    const newFat = fat_pct !== undefined ? (fat_pct === '' || fat_pct == null ? null : Number(fat_pct)) : md.fat_pct;
    const newNote = note !== undefined ? (note || null) : md.note;
    const newAmount = Math.round(newWeight * newPrice);

    await conn.query(
      'UPDATE milk_deliveries SET shift=?, weight_kg=?, fat_pct=?, price_per_kg=?, amount=?, note=? WHERE id=?',
      [newShift, newWeight, newFat, newPrice, newAmount, newNote, id]);

    // تراکنشِ فعالِ مرتبط را هم‌زمان اصلاح کن (ویرایشِ مستقیم، نه ابطال)
    const [[tx]] = await conn.query(
      "SELECT * FROM transactions WHERE source_type='milk_delivery' AND source_id=? AND status='active' LIMIT 1", [id]);
    if (tx) {
      if (tx.is_locked) throw new AppError(409, 'تراکنش در ماه بسته‌شده قابل ویرایش نیست');
      const label = newShift === 'morning' ? 'شیر صبح' : 'شیر شب';
      const desc = `${label} — ${newWeight} کیلو × ${newPrice.toLocaleString('fa')}`;
      await conn.query('UPDATE transactions SET amount=?, description=? WHERE id=?', [newAmount, desc, tx.id]);
    }

    // اگر این تحویل بخشی از یک فاکتور است، مبلغِ شیر و خالصِ فاکتور را به‌روز کن
    const [[rc]] = await conn.query('SELECT * FROM receipts WHERE milk_delivery_id=?', [id]);
    if (rc) {
      await conn.query('UPDATE receipts SET milk_amount=?, net_amount=? WHERE id=?',
        [newAmount, Number(newAmount) - Number(rc.purchase_amount), rc.id]);
    }

    await conn.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, old_json, user_id, reason)
       VALUES ('milk_deliveries', ?, 'update', ?, ?, ?)`,
      [id, JSON.stringify(md), req.user?.uid || null, 'ویرایش تحویل شیر']);
    await recomputeBalance(conn, md.person_id);
  });
  res.json({ ok: true });
}));

// حذف/ابطال تحویل شیر — فقط تا قبل از «بستن روز». تراکنش معکوس می‌شود (نه حذف فیزیکی).
router.delete('/deliveries/:id', wrap(async (req, res) => {
  const id = req.params.id;
  const reason = req.body?.reason || 'حذف تحویل شیر';
  await withTx(async (conn) => {
    const [[md]] = await conn.query('SELECT * FROM milk_deliveries WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!md) throw new AppError(404, 'تحویل شیر یافت نشد');
    const day = await recordDay(conn, 'milk_deliveries', 'delivered_at', id);
    await assertDayOpen(conn, day, md.branch_id);

    const [[rc]] = await conn.query('SELECT id FROM receipts WHERE milk_delivery_id=? AND voided_at IS NULL', [id]);
    if (rc) throw new AppError(409, 'این تحویل بخشی از یک فاکتور است؛ به‌جای حذف، فاکتور را باطل کنید');

    await conn.query('UPDATE milk_deliveries SET deleted_at = NOW() WHERE id = ?', [id]);
    await voidTransactionsBySource(conn, { sourceType: 'milk_delivery', sourceId: id, userId: req.user?.uid, reason });
    await conn.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, old_json, user_id, reason)
       VALUES ('milk_deliveries', ?, 'delete', ?, ?, ?)`,
      [id, JSON.stringify(md), req.user?.uid || null, reason]);
    await recomputeBalance(conn, md.person_id);
  });
  res.json({ ok: true });
}));

// لیست تحویل‌های یک دامدار در ماه جاری
router.get('/deliveries', wrap(async (req, res) => {
  const { person_id, month } = req.query;
  const ym = month || currentJalaliMonth();
  const [rows] = await pool.query(
    `SELECT md.*,
            EXISTS(SELECT 1 FROM day_closings dc
                     WHERE dc.day = DATE(md.delivered_at) AND dc.status='closed'
                       AND (dc.branch_id = md.branch_id OR dc.branch_id IS NULL)) AS locked
       FROM milk_deliveries md
      WHERE md.person_id = ? AND md.year_month_jalali = ? AND md.deleted_at IS NULL
      ORDER BY md.delivered_at DESC`, [person_id, ym]);
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
