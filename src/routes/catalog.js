import { Router } from 'express';
import { pool } from '../db.js';
import { auth } from '../mw/auth.js';
import { jalaliYearMonth } from '../util.js';

export const router = Router();
router.use(auth);

// کالاها
router.get('/products', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT p.id, p.code, p.name, p.unit, p.base_price, c.name AS category
     FROM products p LEFT JOIN product_categories c ON c.id=p.category_id
     WHERE p.is_active=1 ORDER BY p.name`);
  res.json(rows);
});

// قیمت شیر ماه جاری (عمومی یا اختصاصی شخص)
router.get('/milk-price', async (req, res) => {
  const ym = req.query.month || jalaliYearMonth();
  const personId = req.query.person_id || null;
  // اول قیمت اختصاصی شخص، سپس عمومی همان ماه
  const [rows] = await pool.execute(
    `SELECT price_per_kg, person_id FROM milk_prices
     WHERE period_ym=:ym AND (person_id=:pid OR person_id IS NULL)
     ORDER BY person_id IS NULL ASC LIMIT 1`,
    { ym, pid: personId }
  );
  if (!rows.length) return res.json({ month: ym, price_per_kg: null });
  res.json({ month: ym, price_per_kg: Number(rows[0].price_per_kg), specific: rows[0].person_id != null });
});

// تعیین/به‌روزرسانی قیمت عمومی ماه
router.post('/milk-price', async (req, res) => {
  const { month, price_per_kg, person_id = null } = req.body || {};
  const ym = month || jalaliYearMonth();
  if (!price_per_kg) return res.status(400).json({ error: 'قیمت لازم است' });
  await pool.execute(
    `INSERT INTO milk_prices (period_ym, person_id, price_per_kg) VALUES (:ym,:pid,:price)
     ON DUPLICATE KEY UPDATE price_per_kg=:price`,
    { ym, pid: person_id, price: price_per_kg }
  );
  res.json({ ok: true, month: ym, price_per_kg });
});
