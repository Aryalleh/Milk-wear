// تنظیمات عمومی (کلید/مقدار) — خواندن برای کارمند، نوشتن برای مدیر
import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../auth.js';
import { AppError, wrap } from '../util.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query("SELECT `key`, value_json FROM settings WHERE scope='global'");
  const map = {};
  for (const r of rows) { try { map[r.key] = JSON.parse(r.value_json); } catch { map[r.key] = r.value_json; } }
  res.json(map);
}));

router.put('/:key', requireRole('admin'), wrap(async (req, res) => {
  const { value } = req.body;
  if (value === undefined) throw new AppError(400, 'مقدار لازم است');
  await pool.query(
    `INSERT INTO settings (scope, scope_id, \`key\`, value_json) VALUES ('global', NULL, ?, ?)
     ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)`,
    [req.params.key, JSON.stringify(value)]);
  res.json({ ok: true });
}));

export default router;
