// انبارداری — موجودی، ورودی، فروش‌رفته
import { Router } from 'express';
import { pool } from '../db.js';
import { staffRequired } from '../auth.js';
import { wrap } from '../util.js';

const router = Router();
router.use(staffRequired);

// خلاصهٔ موجودی هر کالا: چی داریم، چی اومده، چی فروش رفته
router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.code, p.name, u.symbol AS unit, c.name AS category,
            COALESCE(SUM(CASE WHEN sm.direction='in'  THEN sm.quantity ELSE 0 END),0) AS total_in,
            COALESCE(SUM(CASE WHEN sm.direction='out' THEN sm.quantity ELSE 0 END),0) AS total_out,
            COALESCE(SUM(CASE WHEN sm.direction='in'  THEN sm.quantity ELSE -sm.quantity END),0) AS on_hand
       FROM products p
       LEFT JOIN units u ON u.id = p.unit_id
       LEFT JOIN product_categories c ON c.id = p.category_id
       LEFT JOIN stock_movements sm ON sm.product_id = p.id
      WHERE p.track_stock = 1 AND p.is_active = 1
      GROUP BY p.id ORDER BY p.name`);
  res.json(rows);
}));

// فهرست همهٔ انبارها (برای فرم ورود کالا)
router.get('/warehouses', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT w.id, w.name, b.name AS branch_name
       FROM warehouses w LEFT JOIN branches b ON b.id = w.branch_id
      WHERE w.is_active = 1 ORDER BY w.id`);
  res.json(rows);
}));

// ثبت ورود کالا به انبار (خرید/تأمین) — «چیا اومده»
router.post('/receive', wrap(async (req, res) => {
  const { warehouse_id, product_id, quantity, unit_cost, note } = req.body;
  if (!warehouse_id || !product_id || !quantity)
    return res.status(400).json({ error: 'انبار، کالا و مقدار لازم است' });
  await pool.query(
    `INSERT INTO stock_movements (warehouse_id, product_id, direction, quantity, unit_cost, source_type, created_by)
     VALUES (?,?, 'in', ?, ?, 'purchase', ?)`,
    [warehouse_id, product_id, quantity, unit_cost || null, req.user.uid || null]);
  await pool.query(
    `INSERT INTO stock_balances (warehouse_id, product_id, quantity, last_movement_at)
     VALUES (?,?,?, NOW())
     ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), last_movement_at = NOW()`,
    [warehouse_id, product_id, quantity]);
  res.status(201).json({ ok: true });
}));

export default router;
