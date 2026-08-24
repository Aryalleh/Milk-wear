// گزارش‌گیری مالی و جنسی با بازهٔ تاریخ (روزانه/ماهانه/دلخواه)
import { Router } from 'express';
import { pool } from '../db.js';
import { staffRequired, requireRole } from '../auth.js';
import { wrap, toJalaliDate } from '../util.js';
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
  res.json({
    from, to,
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

export default router;
