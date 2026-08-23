import { Router } from 'express';
import { pool } from '../db.js';
import { AppError, wrap } from '../util.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category, u.symbol AS unit
       FROM products p
       LEFT JOIN product_categories c ON c.id = p.category_id
       LEFT JOIN units u ON u.id = p.unit_id
      WHERE p.is_active = 1 ORDER BY p.name`);
  res.json(rows);
}));

// دسته‌ها و واحدها (برای فرم تعریف کالای جدید)
router.get('/meta', wrap(async (req, res) => {
  const [categories] = await pool.query('SELECT id, name FROM product_categories ORDER BY id');
  const [units] = await pool.query('SELECT id, name, symbol FROM units ORDER BY id');
  res.json({ categories, units });
}));

// تعریف کالای جدید (فقط کارمند)
router.post('/', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'فقط کارمندان می‌توانند کالا تعریف کنند');
  const { name, category_id, unit_id, base_price, track_stock, code } = req.body;
  if (!name) throw new AppError(400, 'نام کالا لازم است');
  const finalCode = (code && code.trim()) || `P${Date.now().toString().slice(-8)}`;

  const [[dup]] = await pool.query('SELECT id FROM products WHERE code = ?', [finalCode]);
  if (dup) throw new AppError(409, 'این کد کالا قبلاً ثبت شده');

  const [r] = await pool.query(
    `INSERT INTO products (code, name, category_id, unit_id, base_price, track_stock)
     VALUES (?,?,?,?,?,?)`,
    [finalCode, name, category_id || null, unit_id || null,
     Math.round(Number(base_price) || 0), track_stock === false ? 0 : 1]
  );
  res.status(201).json({ id: r.insertId, code: finalCode });
}));

export default router;
