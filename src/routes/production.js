// تولید: فراوری شیر خام به محصولات لبنی
import { Router } from 'express';
import { pool, withTx } from '../db.js';
import { staffRequired } from '../auth.js';
import { AppError, wrap, toJalaliDate } from '../util.js';

const router = Router();
router.use(staffRequired);

// ثبت یک بَچ تولید: مصرف شیر خام → تولید محصولات (ورود به انبار)
// body: { milk_kg, outputs:[{ product_id, quantity, warehouse_id }], note }
router.post('/', wrap(async (req, res) => {
  const { milk_kg, outputs, note } = req.body;
  if (!milk_kg || !Array.isArray(outputs) || outputs.length === 0)
    throw new AppError(400, 'مقدار شیر ورودی و حداقل یک محصول خروجی لازم است');

  const [[rawMilk]] = await pool.query('SELECT id FROM products WHERE is_raw_milk = 1 LIMIT 1');
  if (!rawMilk) throw new AppError(400, 'کالای «شیر خام» تعریف نشده است');

  const out = await withTx(async (conn) => {
    const batchCode = `PB${Date.now().toString().slice(-9)}`;
    const [b] = await conn.query(
      `INSERT INTO production_batches (branch_id, batch_code, started_at, finished_at, status, note)
       VALUES (NULL, ?, NOW(), NOW(), 'done', ?)`, [batchCode, note || null]);
    const batchId = b.insertId;

    // ورودی: شیر خام مصرف‌شده
    await conn.query(
      `INSERT INTO production_inputs (batch_id, product_id, warehouse_id, quantity)
       VALUES (?,?, NULL, ?)`, [batchId, rawMilk.id, milk_kg]);

    // خروجی‌ها: محصولات تولیدشده → ورود به انبار
    for (const o of outputs) {
      if (!o.product_id || !o.quantity) continue;
      await conn.query(
        `INSERT INTO production_outputs (batch_id, product_id, warehouse_id, quantity)
         VALUES (?,?,?,?)`, [batchId, o.product_id, o.warehouse_id || null, o.quantity]);
      if (o.warehouse_id) {
        await conn.query(
          `INSERT INTO stock_movements (warehouse_id, product_id, direction, quantity, source_type, source_id, created_by)
           VALUES (?,?, 'in', ?, 'production_out', ?, ?)`,
          [o.warehouse_id, o.product_id, o.quantity, batchId, req.user.uid || null]);
        await conn.query(
          `INSERT INTO stock_balances (warehouse_id, product_id, quantity, last_movement_at)
           VALUES (?,?,?, NOW())
           ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), last_movement_at = NOW()`,
          [o.warehouse_id, o.product_id, o.quantity]);
      }
    }
    return { id: batchId, batch_code: batchCode };
  });
  res.status(201).json(out);
}));

// فهرست بَچ‌های اخیر تولید
router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT pb.id, pb.batch_code, pb.started_at,
            (SELECT COALESCE(SUM(quantity),0) FROM production_inputs pi WHERE pi.batch_id=pb.id) AS milk_kg,
            (SELECT GROUP_CONCAT(CONCAT(pr.name,' ', po.quantity) SEPARATOR '، ')
               FROM production_outputs po JOIN products pr ON pr.id=po.product_id
              WHERE po.batch_id=pb.id) AS outputs
       FROM production_batches pb ORDER BY pb.id DESC LIMIT 50`);
  res.json(rows.map((r) => ({ ...r, started_jalali: toJalaliDate(r.started_at), milk_kg: Number(r.milk_kg) })));
}));

export default router;
