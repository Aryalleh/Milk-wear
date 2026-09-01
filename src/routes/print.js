// مدیریت چاپ برای کارمند/مدیر: فهرست صف، چاپ مجدد، اجرای دستهٔ بارنامه‌ها، توکن ایجنت
import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../auth.js';
import { AppError, wrap } from '../util.js';
import {
  enqueueWaybill, enqueueReceipt, enqueueStatement, enqueueManifest, enqueuePrint, runBatchNow, getAgentToken, getSettings,
} from '../print.js';
import { renderElementToPng } from '../render.js';

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

// چاپ همهٔ بارنامه‌های بارگیری (راننده) — order_ids مشخص، یا همهٔ سفارش‌های ارسالیِ در انتظار
router.post('/waybills', wrap(async (req, res) => {
  let ids = Array.isArray(req.body?.order_ids) ? req.body.order_ids.map(Number).filter(Boolean) : null;
  if (!ids || !ids.length) {
    const [rows] = await pool.query(
      "SELECT id FROM orders WHERE deleted_at IS NULL AND fulfillment_type='delivery' AND status IN ('queued','confirmed') ORDER BY id");
    ids = rows.map((r) => r.id);
  }
  let printed = 0;
  for (const id of ids) { if (await enqueueWaybill(id)) printed++; }
  res.json({ ok: true, printed });
}));

// چاپ مجدد یک فاکتور
router.post('/receipt/:receiptId', wrap(async (req, res) => {
  const id = await enqueueReceipt(req.params.receiptId, Number(req.body?.copies || 1));
  if (!id) throw new AppError(404, 'فاکتور یافت نشد');
  res.status(201).json({ ok: true, job_id: id });
}));

// چاپ حرارتیِ صورتحساب یک شخص (به صف ایجنت)
router.post('/statement', wrap(async (req, res) => {
  const { person_id, from, to, since } = req.body || {};
  if (!person_id) throw new AppError(400, 'شخص لازم است');
  const p = new URLSearchParams();
  p.set('person_id', String(person_id));
  if (since) p.set('since', 'settlement'); else if (from) p.set('from', from);
  if (to) p.set('to', to);
  const id = await enqueueStatement(p.toString());
  res.status(201).json({ ok: true, job_id: id });
}));

// چاپ مانیفست بارگیری (به صف ایجنت)
router.post('/manifest', wrap(async (req, res) => {
  const id = await enqueueManifest();
  res.status(201).json({ ok: true, job_id: id });
}));

// پیش‌نمایشِ چاپ (همان تصویری که ایجنت چاپ می‌کند) — برای نمایش قبل از ارسال به صف
router.get('/preview', wrap(async (req, res) => {
  const kind = req.query.kind;
  let png;
  if (kind === 'receipt') png = await renderElementToPng(`/receipt.html?id=${Number(req.query.id)}`, '#card');
  else if (kind === 'waybill') png = await renderElementToPng(`/waybill.html?id=${Number(req.query.id)}`, '#card');
  else if (kind === 'manifest') png = await renderElementToPng('/manifest.html', '#card');
  else if (kind === 'statement') {
    const p = new URLSearchParams();
    p.set('person_id', String(Number(req.query.person_id)));
    if (req.query.since) p.set('since', 'settlement'); else if (req.query.from) p.set('from', req.query.from);
    if (req.query.to) p.set('to', req.query.to);
    png = await renderElementToPng(`/statement.html?${p.toString()}`, '#receipt');
  } else throw new AppError(400, 'نوع نامعتبر');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.send(png);
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
