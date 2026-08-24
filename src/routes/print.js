// مدیریت چاپ برای کارمند/مدیر: فهرست صف، چاپ مجدد، اجرای دستهٔ بارنامه‌ها، توکن ایجنت
import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../auth.js';
import { AppError, wrap } from '../util.js';
import {
  enqueueWaybill, enqueueReceipt, enqueuePrint, runBatchNow, getAgentToken, getSettings,
} from '../print.js';

const router = Router();

// فهرست کارهای صف چاپ (جدیدترین‌ها)
router.get('/jobs', wrap(async (req, res) => {
  const { status } = req.query;
  const where = [], params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  const [rows] = await pool.query(
    `SELECT id, kind, ref_type, ref_id, status, copies, attempts, error, agent_id,
            created_at, printed_at
       FROM print_jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY id DESC LIMIT 100`, params);
  res.json(rows);
}));

// شمارش سریع وضعیت صف
router.get('/summary', wrap(async (req, res) => {
  const [rows] = await pool.query(
    "SELECT status, COUNT(*) n FROM print_jobs GROUP BY status");
  const map = { queued: 0, printing: 0, done: 0, error: 0 };
  for (const r of rows) map[r.status] = Number(r.n);
  res.json(map);
}));

// چاپ مجدد یک بارنامه
router.post('/waybill/:orderId', wrap(async (req, res) => {
  const id = await enqueueWaybill(req.params.orderId, Number(req.body?.copies || 1));
  if (!id) throw new AppError(404, 'سفارش یافت نشد');
  res.status(201).json({ ok: true, job_id: id });
}));

// چاپ مجدد یک فاکتور
router.post('/receipt/:receiptId', wrap(async (req, res) => {
  const id = await enqueueReceipt(req.params.receiptId, Number(req.body?.copies || 1));
  if (!id) throw new AppError(404, 'فاکتور یافت نشد');
  res.status(201).json({ ok: true, job_id: id });
}));

// اجرای دستیِ دستهٔ بارنامه‌ها (بی‌توجه به ساعت) — مدیر
router.post('/run-batch', requireRole('admin'), wrap(async (req, res) => {
  const printed = await runBatchNow();
  res.json({ ok: true, printed });
}));

// چاپ تستی (برای بررسی اتصال پرینتر/ایجنت) — مدیر
router.post('/test', requireRole('admin'), wrap(async (req, res) => {
  const s = await getSettings();
  const id = await enqueuePrint({
    kind: 'test',
    payload: {
      doc: 'test', title: 'چاپ آزمایشی',
      branch: { name: 'لبنیات محمدپور', phone: s.branch_phone || '', address: '' },
      message: 'اتصال پرینت‌ایجنت سالم است ✔', date_ts: Date.now(),
    },
  });
  res.status(201).json({ ok: true, job_id: id });
}));

// نمایش توکن ایجنت برای نصب (فقط مدیر)
router.get('/agent-token', requireRole('admin'), wrap(async (req, res) => {
  res.json({ token: await getAgentToken() });
}));

export default router;
