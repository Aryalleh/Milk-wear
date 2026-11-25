// انبارداری — موجودی، ورودی، فروش‌رفته
import { Router } from 'express';
import { pool, withTx } from '../db.js';
import { staffRequired } from '../auth.js';
import { AppError, wrap } from '../util.js';

const router = Router();
router.use(staffRequired);

// خلاصهٔ موجودی هر کالا: چی داریم، چی اومده، چی فروش رفته
//  همهٔ کالاهای فعال نمایش داده می‌شوند (حتی اگر ردیابی موجودی‌شان خاموش باشد) تا بشود شارژشان کرد.
//  جمع‌ها در زیرکوئری حساب می‌شوند تا با ONLY_FULL_GROUP_BY هم خطا ندهد.
router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.code, p.name, p.reorder_level, p.base_price, p.track_stock, p.is_raw_milk,
            u.symbol AS unit, c.name AS category,
            COALESCE(m.total_in,0) AS total_in, COALESCE(m.total_out,0) AS total_out,
            COALESCE(m.total_in,0) - COALESCE(m.total_out,0) AS on_hand
       FROM products p
       LEFT JOIN units u ON u.id = p.unit_id
       LEFT JOIN product_categories c ON c.id = p.category_id
       LEFT JOIN (SELECT product_id,
                         SUM(CASE WHEN direction='in'  THEN quantity ELSE 0 END) AS total_in,
                         SUM(CASE WHEN direction='out' THEN quantity ELSE 0 END) AS total_out
                    FROM stock_movements GROUP BY product_id) m ON m.product_id = p.id
      WHERE p.is_active = 1
      ORDER BY p.track_stock DESC, p.name`);
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
  const { warehouse_id, product_id, quantity, unit_cost } = req.body;
  if (!warehouse_id || !product_id || !(Number(quantity) > 0))
    throw new AppError(400, 'انبار، کالا و مقدار لازم است');
  await withTx(async (conn) => {
    await move(conn, { warehouse_id, product_id, direction: 'in', quantity: Number(quantity),
      unit_cost: unit_cost || null, source_type: 'purchase', uid: req.user.uid });
  });
  res.status(201).json({ ok: true });
}));

// اصلاحِ دستیِ موجودی (کم/زیاد کردن) — مثلاً بعد از شمارش انبار، خرابی یا اشتباه ثبت
//  body: { warehouse_id, product_id, direction: 'in'|'out', quantity, note }
router.post('/adjust', wrap(async (req, res) => {
  const { warehouse_id, product_id, direction, quantity, note } = req.body;
  const q = Number(quantity);
  if (!warehouse_id || !product_id || !(q > 0)) throw new AppError(400, 'انبار، کالا و مقدار لازم است');
  if (!['in', 'out'].includes(direction)) throw new AppError(400, 'جهت نامعتبر');
  await withTx(async (conn) => {
    if (direction === 'out') {
      const [[b]] = await conn.query(
        'SELECT quantity FROM stock_balances WHERE warehouse_id=? AND product_id=? FOR UPDATE', [warehouse_id, product_id]);
      const have = Number(b?.quantity || 0);
      if (q > have) throw new AppError(400, `موجودی این انبار ${have.toLocaleString('fa-IR')} است؛ بیشتر از این نمی‌شود کم کرد`);
    }
    const id = await move(conn, { warehouse_id, product_id, direction, quantity: q, source_type: 'adjustment', uid: req.user.uid });
    await conn.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, new_json, user_id, reason) VALUES ('stock_movements', ?, 'adjust', ?, ?, ?)`,
      [id, JSON.stringify({ warehouse_id, product_id, direction, quantity: q }), req.user.uid || null, note || null]);
  });
  res.status(201).json({ ok: true });
}));

// ثبت یک حرکت انبار + به‌روزرسانی مانده؛ شارژِ کالا ردیابیِ موجودی‌اش را روشن می‌کند
async function move(conn, { warehouse_id, product_id, direction, quantity, unit_cost = null, source_type, uid }) {
  const [[p]] = await conn.query('SELECT id FROM products WHERE id=?', [product_id]);
  if (!p) throw new AppError(404, 'کالا یافت نشد');
  const [r] = await conn.query(
    `INSERT INTO stock_movements (warehouse_id, product_id, direction, quantity, unit_cost, source_type, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [warehouse_id, product_id, direction, quantity, unit_cost, source_type, uid || null]);
  const delta = direction === 'in' ? quantity : -quantity;
  await conn.query(
    `INSERT INTO stock_balances (warehouse_id, product_id, quantity, last_movement_at)
     VALUES (?,?,?, NOW())
     ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), last_movement_at = NOW()`,
    [warehouse_id, product_id, delta]);
  if (direction === 'in') await conn.query('UPDATE products SET track_stock=1 WHERE id=? AND track_stock=0', [product_id]);
  return r.insertId;
}

export default router;
