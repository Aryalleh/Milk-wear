import { Router } from 'express';
import { pool } from '../db.js';
import { wrap } from '../util.js';

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

export default router;
