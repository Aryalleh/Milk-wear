// نمایش عمومی فاکتور با توکن هش‌شده (بدون نیاز به ورود) — برای اسکن QR
import { Router } from 'express';
import { pool } from '../db.js';
import { AppError, wrap } from '../util.js';
import { buildReceiptView } from './receipts.js';
import { getSettings } from '../print.js';

const router = Router();

// لوگوی برند (data URI) برای سربرگ فاکتور/بارنامه/صورتحساب — بدون احراز، برای نمایش عمومیِ فاکتور هم لازم است
router.get('/logo', wrap(async (req, res) => {
  const s = await getSettings();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ logo: s.brand_logo || null });
}));

router.get('/receipt/:token', wrap(async (req, res) => {
  const t = String(req.params.token || '');
  if (!/^[0-9a-f]{32}$/.test(t)) throw new AppError(400, 'توکن نامعتبر');
  const [[rc]] = await pool.query('SELECT * FROM receipts WHERE public_token = ?', [t]);
  if (!rc) throw new AppError(404, 'فاکتور یافت نشد');
  res.json(await buildReceiptView(rc));
}));

export default router;
