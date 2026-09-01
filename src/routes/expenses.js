// هزینه‌های کسب‌وکار: حقوق، قبوض، خودرو، ملزومات… + قالب‌های تکرارشونده
import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../auth.js';
import { AppError, wrap, toJalaliDate, currentJalaliMonth } from '../util.js';

const router = Router();

const CATS = ['salary', 'utilities', 'rent', 'vehicle', 'supplies', 'tax', 'other'];
const ymOf = (d) => { try { const x = new Date(d); const p = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: '2-digit' }).formatToParts(x); return `${p.find((q) => q.type === 'year').value}-${p.find((q) => q.type === 'month').value}`; } catch { return currentJalaliMonth(); } };

function range(req) {
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const from = req.query.from || to;
  return { from, to };
}

// فهرست هزینه‌ها در بازه + جمع بر اساس دسته
router.get('/', wrap(async (req, res) => {
  const { from, to } = range(req);
  const [rows] = await pool.query(
    `SELECT e.id, e.category, e.title, e.amount, e.spent_at, e.note, u.fullname AS ref_user
       FROM expenses e LEFT JOIN users u ON u.id = e.ref_user_id
      WHERE DATE(e.spent_at) BETWEEN ? AND ?
      ORDER BY e.spent_at DESC, e.id DESC LIMIT 500`, [from, to]);
  const [[t]] = await pool.query(
    'SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE DATE(spent_at) BETWEEN ? AND ?', [from, to]);
  const [byCat] = await pool.query(
    `SELECT category, COALESCE(SUM(amount),0) total FROM expenses
      WHERE DATE(spent_at) BETWEEN ? AND ? GROUP BY category`, [from, to]);
  res.json({
    from, to, total: Number(t.total),
    by_category: byCat.map((c) => ({ category: c.category, total: Number(c.total) })),
    rows: rows.map((r) => ({
      id: r.id, category: r.category, title: r.title, amount: Number(r.amount),
      spent_jalali: toJalaliDate(r.spent_at), note: r.note, ref_user: r.ref_user,
    })),
  });
}));

// ثبت هزینه — مدیر/حسابدار
router.post('/', requireRole('admin', 'accountant'), wrap(async (req, res) => {
  const { category = 'other', title, amount, spent_at, ref_user_id, note, branch_id } = req.body;
  if (!title || !title.trim()) throw new AppError(400, 'عنوان هزینه لازم است');
  if (!(Number(amount) > 0)) throw new AppError(400, 'مبلغ معتبر لازم است');
  const cat = CATS.includes(category) ? category : 'other';
  const date = spent_at || new Date().toISOString().slice(0, 10);
  const [r] = await pool.query(
    `INSERT INTO expenses (branch_id, category, title, amount, ref_user_id, spent_at, year_month_jalali, note, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [branch_id || null, cat, title.trim(), Math.round(Number(amount)), ref_user_id || null, date, ymOf(date), note || null, req.user?.uid || null]);
  res.status(201).json({ id: r.insertId });
}));

// حذف هزینه — مدیر/حسابدار
router.delete('/:id', requireRole('admin', 'accountant'), wrap(async (req, res) => {
  await pool.query('DELETE FROM expenses WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// ---- قالب‌ها ----
router.get('/templates', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT t.id, t.category, t.title, t.default_amount, u.fullname AS ref_user, t.ref_user_id
       FROM expense_templates t LEFT JOIN users u ON u.id = t.ref_user_id ORDER BY t.id DESC`);
  res.json(rows.map((r) => ({ id: r.id, category: r.category, title: r.title, default_amount: Number(r.default_amount), ref_user: r.ref_user, ref_user_id: r.ref_user_id })));
}));

router.post('/templates', requireRole('admin', 'accountant'), wrap(async (req, res) => {
  const { category = 'other', title, default_amount = 0, ref_user_id } = req.body;
  if (!title || !title.trim()) throw new AppError(400, 'عنوان قالب لازم است');
  const cat = CATS.includes(category) ? category : 'other';
  const [r] = await pool.query(
    'INSERT INTO expense_templates (category, title, default_amount, ref_user_id) VALUES (?,?,?,?)',
    [cat, title.trim(), Math.round(Number(default_amount) || 0), ref_user_id || null]);
  res.status(201).json({ id: r.insertId });
}));

router.delete('/templates/:id', requireRole('admin', 'accountant'), wrap(async (req, res) => {
  await pool.query('DELETE FROM expense_templates WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
