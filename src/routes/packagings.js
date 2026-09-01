// مدیریت بسته‌بندی/ظرف‌ها و لایه‌های قیمت (FIFO)
import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../auth.js';
import { AppError, wrap, toJalaliDate } from '../util.js';

const router = Router();

// فهرست ظرف‌ها + موجودی کل + لایه‌های باقی‌مانده (باقیِ هر قیمت)
router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT g.id, g.name, g.default_price, g.margin_pct, u.symbol AS unit,
            COALESCE((SELECT SUM(remaining_qty) FROM packaging_layers l WHERE l.packaging_id=g.id),0) AS on_hand
       FROM packagings g LEFT JOIN units u ON u.id=g.unit_id
      WHERE g.is_active=1 ORDER BY g.id`);
  const [layers] = await pool.query(
    'SELECT packaging_id, unit_price, remaining_qty, qty FROM packaging_layers WHERE remaining_qty>0 ORDER BY purchased_at, id');
  const byPkg = {};
  for (const l of layers) { (byPkg[l.packaging_id] ||= []).push({ unit_price: Number(l.unit_price), remaining: Number(l.remaining_qty), qty: Number(l.qty) }); }
  res.json(rows.map((r) => {
    const ls = byPkg[r.id] || [];
    return {
      id: r.id, name: r.name, unit: r.unit || '', default_price: Number(r.default_price), margin_pct: Number(r.margin_pct),
      on_hand: Number(r.on_hand), next_price: ls.length ? ls[0].unit_price : null, layers: ls,
    };
  }));
}));

// ساخت ظرف — مدیر/حسابدار
router.post('/', requireRole('admin', 'accountant'), wrap(async (req, res) => {
  const { name, unit_id, default_price = 0, margin_pct = 0 } = req.body;
  if (!name || !name.trim()) throw new AppError(400, 'نام ظرف لازم است');
  const [r] = await pool.query('INSERT INTO packagings (name, unit_id, default_price, margin_pct) VALUES (?,?,?,?)',
    [name.trim(), unit_id || null, Math.round(Number(default_price) || 0), Number(margin_pct) || 0]);
  res.status(201).json({ id: r.insertId });
}));

// ویرایش ظرف (قیمت پیش‌فرض/درصد سود) — مدیر/حسابدار
router.put('/:id', requireRole('admin', 'accountant'), wrap(async (req, res) => {
  const { name, default_price, margin_pct } = req.body;
  await pool.query('UPDATE packagings SET name=COALESCE(?,name), default_price=COALESCE(?,default_price), margin_pct=COALESCE(?,margin_pct) WHERE id=?',
    [name ?? null, default_price != null ? Math.round(Number(default_price)) : null, margin_pct != null ? Number(margin_pct) : null, req.params.id]);
  res.json({ ok: true });
}));

// خرید ظرف = افزودن یک لایهٔ قیمت (FIFO)
router.post('/:id/purchase', requireRole('admin', 'accountant'), wrap(async (req, res) => {
  const { qty, unit_price, purchased_at, note } = req.body;
  if (!(Number(qty) > 0)) throw new AppError(400, 'تعداد معتبر لازم است');
  if (!(Number(unit_price) >= 0)) throw new AppError(400, 'قیمت معتبر لازم است');
  const [[g]] = await pool.query('SELECT id FROM packagings WHERE id=?', [req.params.id]);
  if (!g) throw new AppError(404, 'ظرف یافت نشد');
  const [r] = await pool.query(
    `INSERT INTO packaging_layers (packaging_id, qty, unit_price, remaining_qty, purchased_at, note, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [req.params.id, Number(qty), Math.round(Number(unit_price)), Number(qty),
     purchased_at ? new Date(purchased_at) : new Date(), note || null, req.user?.uid || null]);
  res.status(201).json({ id: r.insertId });
}));

// لایه‌های یک ظرف
router.get('/:id/layers', wrap(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, qty, unit_price, remaining_qty, purchased_at FROM packaging_layers WHERE packaging_id=? ORDER BY purchased_at DESC, id DESC LIMIT 100',
    [req.params.id]);
  res.json(rows.map((r) => ({ id: r.id, qty: Number(r.qty), unit_price: Number(r.unit_price), remaining_qty: Number(r.remaining_qty), date: toJalaliDate(r.purchased_at) })));
}));

// انتساب ظرف به یک کالا
router.put('/assign/:productId', requireRole('admin', 'accountant'), wrap(async (req, res) => {
  const { packaging_id, packaging_capacity } = req.body;
  await pool.query('UPDATE products SET packaging_id=?, packaging_capacity=? WHERE id=?',
    [packaging_id || null, Number(packaging_capacity) > 0 ? Number(packaging_capacity) : 1, req.params.productId]);
  res.json({ ok: true });
}));

export default router;
