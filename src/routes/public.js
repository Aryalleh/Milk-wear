// نمایش عمومی فاکتور با توکن هش‌شده (بدون نیاز به ورود) — برای اسکن QR
import { Router } from 'express';
import { pool } from '../db.js';
import { AppError, wrap } from '../util.js';
import { buildReceiptView } from './receipts.js';

const router = Router();

router.get('/receipt/:token', wrap(async (req, res) => {
  const t = String(req.params.token || '');
  if (!/^[0-9a-f]{32}$/.test(t)) throw new AppError(400, 'توکن نامعتبر');
  const [[rc]] = await pool.query('SELECT * FROM receipts WHERE public_token = ?', [t]);
  if (!rc) throw new AppError(404, 'فاکتور یافت نشد');
  res.json(await buildReceiptView(rc));
}));

export default router;
