// گزارش‌گیری مالی و جنسی با بازهٔ تاریخ (روزانه/ماهانه/دلخواه)
import { Router } from 'express';
import { pool } from '../db.js';
import { staffRequired, requireRole } from '../auth.js';
import { wrap, toJalaliDate, AppError, currentJalaliMonth } from '../util.js';
import { runBackup, runDailyReport } from '../cron.js';

const router = Router();
router.use(staffRequired);

// اجرای دستی بک‌آپ و گزارش روزانه (برای تست) — فقط مدیر
router.post('/backup-now', requireRole('admin'), wrap(async (req, res) => { res.json(await runBackup()); }));
router.post('/daily-now', requireRole('admin'), wrap(async (req, res) => { res.json(await runDailyReport()); }));

function range(req) {
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const from = req.query.from || to;
  return { from, to };
}

// گزارش مالی: تراکنش‌ها + جمع بر اساس نوع
router.get('/financial', wrap(async (req, res) => {
  const { from, to } = range(req);
  const [rows] = await pool.query(
    `SELECT t.tx_date, t.tx_type, t.direction, t.amount, t.description, p.fullname
       FROM transactions t JOIN persons p ON p.id = t.person_id
      WHERE t.status='active' AND DATE(t.tx_date) BETWEEN ? AND ?
      ORDER BY t.tx_date DESC, t.id DESC LIMIT 2000`, [from, to]);
  const [summary] = await pool.query(
    `SELECT tx_type,
            SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END) AS credit,
            SUM(CASE WHEN direction='debit' THEN amount ELSE 0 END) AS debit,
            COUNT(*) cnt
       FROM transactions WHERE status='active' AND DATE(tx_date) BETWEEN ? AND ?
      GROUP BY tx_type`, [from, to]);
  const [[t]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN tx_type IN ('PRODUCT_SALE','FEED_SALE') THEN amount END),0) total_sale,
       COALESCE(SUM(CASE WHEN tx_type='REFUND' THEN amount END),0) refunds,
       COALESCE(SUM(CASE WHEN tx_type='PAYMENT_IN' THEN amount END),0) received,
       COALESCE(SUM(CASE WHEN tx_type IN ('PAYMENT_OUT','CASH_WITHDRAWAL') THEN amount END),0) paid_out,
       COALESCE(SUM(CASE WHEN tx_type IN ('MILK_DELIVERY','PURCHASE','GOODS_IN') THEN amount END),0) purchases
     FROM transactions WHERE status='active' AND DATE(tx_date) BETWEEN ? AND ?`, [from, to]);
  const [[ex]] = await pool.query(
    'SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE DATE(spent_at) BETWEEN ? AND ?', [from, to]);
  const expenses = Number(ex.total);
  const netSale = Number(t.total_sale) - Number(t.refunds);
  const totals = {
    total_sale: Number(t.total_sale),
    net_sale: netSale,
    expenses,                               // هزینه‌های کسب‌وکار (حقوق/قبوض/…)
    profit: netSale - Number(t.purchases) - expenses,   // سود = فروش خالص − خرید − هزینه‌ها
    received: Number(t.received),           // درآمد (دریافت نقدی)
    paid_out: Number(t.paid_out),           // هزینه/پرداختی نقدی
    purchases: Number(t.purchases),         // خرید شیر/کالا از اشخاص
    net_cash: Number(t.received) - Number(t.paid_out),
  };
  res.json({
    from, to, totals,
    summary: summary.map((s) => ({ tx_type: s.tx_type, credit: Number(s.credit), debit: Number(s.debit), count: s.cnt })),
    rows: rows.map((r) => ({
      date: toJalaliDate(r.tx_date), person: r.fullname, tx_type: r.tx_type,
      debit: r.direction === 'debit' ? Number(r.amount) : 0,
      credit: r.direction === 'credit' ? Number(r.amount) : 0,
      description: r.description,
    })),
  });
}));

// گزارش جنسی: فروش/خروج و تولید در بازه
router.get('/goods', wrap(async (req, res) => {
  const { from, to } = range(req);
  const [sold] = await pool.query(
    `SELECT pr.name, u.symbol AS unit,
            COALESCE(SUM(oi.quantity),0) AS qty, COALESCE(SUM(oi.amount),0) AS value
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       JOIN products pr ON pr.id = oi.product_id LEFT JOIN units u ON u.id = pr.unit_id
      WHERE o.deleted_at IS NULL AND DATE(o.ordered_at) BETWEEN ? AND ?
      GROUP BY pr.id ORDER BY value DESC`, [from, to]);
  const [produced] = await pool.query(
    `SELECT pr.name, u.symbol AS unit, COALESCE(SUM(po.quantity),0) AS qty
       FROM production_outputs po JOIN production_batches pb ON pb.id = po.batch_id
       JOIN products pr ON pr.id = po.product_id LEFT JOIN units u ON u.id = pr.unit_id
      WHERE DATE(pb.started_at) BETWEEN ? AND ? GROUP BY pr.id ORDER BY qty DESC`, [from, to]);
  res.json({
    from, to,
    sold: sold.map((r) => ({ name: r.name, unit: r.unit, qty: Number(r.qty), value: Number(r.value) })),
    produced: produced.map((r) => ({ name: r.name, unit: r.unit, qty: Number(r.qty) })),
  });
}));

// گردش حساب یک شخص (دامدار/مشتری) در بازهٔ دلخواه یا از آخرین تسویه — برای نمایش/چاپ
router.get('/statement', wrap(async (req, res) => {
  const personId = Number(req.query.person_id);
  if (!personId) throw new AppError(400, 'شخص لازم است');
  const [[person]] = await pool.query(
    'SELECT id, person_code, fullname, mobile, address FROM persons WHERE id = ?', [personId]);
  if (!person) throw new AppError(404, 'شخص یافت نشد');
  const [[ab]] = await pool.query(
    'SELECT current_balance, last_settlement_at FROM account_balances WHERE person_id = ?', [personId]);

  // بازه: from از پارامتر، یا از «آخرین تسویه»؛ to پیش‌فرض امروز
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  let from = req.query.from || null;
  const sinceSettlement = req.query.since === 'settlement';
  if (sinceSettlement && ab?.last_settlement_at) {
    from = new Date(ab.last_settlement_at).toISOString().slice(0, 10);
  }
  if (!from) from = '1300-01-01';   // از ابتدا

  // ماندهٔ ابتدای دوره = جمع تراکنش‌های پیش از from
  const [[op]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END),0) AS opening
       FROM transactions WHERE person_id = ? AND status='active' AND DATE(tx_date) < ?`,
    [personId, from]);
  let running = Number(op.opening);
  const opening = running;

  const [rows] = await pool.query(
    `SELECT tx_date, tx_type, direction, amount, description
       FROM transactions WHERE person_id = ? AND status='active' AND DATE(tx_date) BETWEEN ? AND ?
      ORDER BY tx_date ASC, id ASC`, [personId, from, to]);

  const ledger = rows.map((r) => {
    const credit = r.direction === 'credit' ? Number(r.amount) : 0;
    const debit = r.direction === 'debit' ? Number(r.amount) : 0;
    running += credit - debit;
    return { date: toJalaliDate(r.tx_date), tx_type: r.tx_type, description: r.description, debit, credit, balance: running };
  });
  const totalCredit = ledger.reduce((s, r) => s + r.credit, 0);
  const totalDebit = ledger.reduce((s, r) => s + r.debit, 0);

  res.json({
    person,
    from, to,
    from_jalali: toJalaliDate(from), to_jalali: toJalaliDate(to),
    last_settlement_jalali: ab?.last_settlement_at ? toJalaliDate(ab.last_settlement_at) : null,
    opening, closing: running,
    total_credit: totalCredit, total_debit: totalDebit,
    current_balance: Number(ab?.current_balance || 0),
    ledger,
  });
}));

// ---- حساب‌کتاب ماهانه + بستن ماه ----
router.get('/months', wrap(async (req, res) => {
  const [tx] = await pool.query(
    `SELECT year_month_jalali ym,
       COALESCE(SUM(CASE WHEN tx_type IN('PRODUCT_SALE','FEED_SALE') THEN amount END),0) sales,
       COALESCE(SUM(CASE WHEN tx_type IN('MILK_DELIVERY','PURCHASE','GOODS_IN') THEN amount END),0) purchases,
       COALESCE(SUM(CASE WHEN tx_type='PAYMENT_IN' THEN amount END),0) received,
       COALESCE(SUM(CASE WHEN tx_type IN('PAYMENT_OUT','CASH_WITHDRAWAL') THEN amount END),0) paid_out
       FROM transactions WHERE status='active' GROUP BY year_month_jalali`);
  const [ex] = await pool.query('SELECT year_month_jalali ym, COALESCE(SUM(amount),0) expenses FROM expenses GROUP BY year_month_jalali');
  const [cl] = await pool.query("SELECT year_month_jalali ym, status FROM month_closings WHERE branch_id IS NULL");
  const map = {};
  const add = (ym) => { if (!map[ym]) map[ym] = { ym, sales: 0, purchases: 0, received: 0, paid_out: 0, expenses: 0, closed: false }; return map[ym]; };
  add(currentJalaliMonth());
  for (const r of tx) { const m = add(r.ym); m.sales = Number(r.sales); m.purchases = Number(r.purchases); m.received = Number(r.received); m.paid_out = Number(r.paid_out); }
  for (const r of ex) add(r.ym).expenses = Number(r.expenses);
  for (const r of cl) if (r.status === 'closed') add(r.ym).closed = true;
  const months = Object.values(map)
    .map((m) => ({ ...m, profit: m.sales - m.purchases - m.expenses }))
    .sort((a, b) => b.ym.localeCompare(a.ym)).slice(0, 12);
  res.json(months);
}));

// بستن ماه: ثبت تراکنش/هزینه در آن ماه ممنوع می‌شود — فقط مدیر
router.post('/months/:ym/close', requireRole('admin'), wrap(async (req, res) => {
  const ym = req.params.ym;
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new AppError(400, 'ماه نامعتبر');
  const [[e]] = await pool.query("SELECT id FROM month_closings WHERE year_month_jalali=? AND branch_id IS NULL", [ym]);
  if (e) await pool.query("UPDATE month_closings SET status='closed', closed_by=?, closed_at=NOW() WHERE id=?", [req.user.uid, e.id]);
  else await pool.query("INSERT INTO month_closings (branch_id, year_month_jalali, status, closed_by) VALUES (NULL,?,'closed',?)", [ym, req.user.uid]);
  res.json({ ok: true });
}));

// بازگشایی ماه — فقط مدیر
router.post('/months/:ym/reopen', requireRole('admin'), wrap(async (req, res) => {
  await pool.query("UPDATE month_closings SET status='open', reopened_by=?, reopened_at=NOW() WHERE year_month_jalali=? AND branch_id IS NULL", [req.user.uid, req.params.ym]);
  res.json({ ok: true });
}));

export default router;
