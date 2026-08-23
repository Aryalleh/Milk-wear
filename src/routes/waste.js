// ثبت و گزارش ضایعات (شیر/محصول)
import { Router } from 'express';
import { pool } from '../db.js';
import { staffRequired } from '../auth.js';
import { AppError, wrap, toJalaliDate } from '../util.js';

const router = Router();
router.use(staffRequired);

router.post('/', wrap(async (req, res) => {
  const { kind = 'milk', product_id, quantity, reason, branch_id } = req.body;
  if (!quantity || Number(quantity) <= 0) throw new AppError(400, 'مقدار ضایعات لازم است');
  const [r] = await pool.query(
    `INSERT INTO waste_log (branch_id, kind, product_id, quantity, reason, created_by)
     VALUES (?,?,?,?,?,?)`,
    [branch_id || null, kind, product_id || null, quantity, reason || null, req.user.uid || null]
  );
  // ضایعات محصول از موجودی انبار کم می‌شود (اگر انبار مشخص شود بعداً)
  res.status(201).json({ id: r.insertId });
}));

router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT w.*, p.name AS product_name FROM waste_log w
       LEFT JOIN products p ON p.id = w.product_id
      ORDER BY w.id DESC LIMIT 100`);
  res.json(rows.map((w) => ({ ...w, occurred_jalali: toJalaliDate(w.occurred_at), quantity: Number(w.quantity) })));
}));

export default router;
