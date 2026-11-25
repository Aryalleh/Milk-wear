// API پرینت‌ایجنت: با توکن (نه سشن) احراز می‌شود. ایجنت کنار پرینتر این‌ها را صدا می‌زند.
import { Router } from 'express';
import { pool } from '../db.js';
import { getAgentToken, isLightPrint } from '../print.js';
import { docHTML } from '../thermal.js';
import { receiptAccount } from './receipts.js';
import { renderHtmlToPng, renderElementToPng } from '../render.js';
import { AppError, wrap } from '../util.js';

const router = Router();

// احراز هویت با توکن ایجنت
router.use(wrap(async (req, res, next) => {
  const token = req.get('x-agent-token') || (req.query.token || '');
  const real = await getAgentToken();
  if (!token || token !== real) throw new AppError(401, 'توکن ایجنت نامعتبر است');
  req.agentId = String(req.get('x-agent-id') || 'agent');
  next();
}));

// سلامت/تست اتصال ایجنت
router.get('/ping', (req, res) => res.json({ ok: true, agent: req.agentId, ts: Date.now() }));

// گرفتن و قفل‌کردنِ اتمیکِ کار بعدیِ صف (یکی در هر بار)
router.post('/poll', wrap(async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[job]] = await conn.query(
      "SELECT * FROM print_jobs WHERE status='queued' ORDER BY id LIMIT 1 FOR UPDATE");
    if (!job) { await conn.commit(); return res.json({ job: null }); }
    await conn.query(
      "UPDATE print_jobs SET status='printing', picked_at=NOW(), attempts=attempts+1, agent_id=? WHERE id=?",
      [req.agentId, job.id]);
    await conn.commit();
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : (job.payload || {});
    // light=true یعنی ایجنت خودش با PIL رسم کند (بدون کروم/بدون درخواستِ /image)
    const light = await isLightPrint();
    // رسمِ سبک توسطِ ایجنتِ فعلی (بدون تغییرِ ایجنت): بدهیِ گذشته و پرداختی به‌صورتِ ردیف به اقلام اضافه
    // و «جمع کل» = مبلغِ قابل‌پرداختِ کل می‌شود — همان چیزی که ایجنت از قبل چاپ می‌کند.
    if (light && (job.kind === 'waybill' || job.kind === 'receipt') && job.ref_id) {
      try { await addDebtRows(job, payload); } catch (e) { console.error('addDebtRows:', e.message); }
    }
    res.json({ job: { id: job.id, kind: job.kind, copies: job.copies, light, payload } });
  } catch (e) {
    await conn.rollback(); throw e;
  } finally {
    conn.release();
  }
}));

// تصویر آمادهٔ چاپِ سند — عیناً همان صفحهٔ HTML (فاکتور/بارنامه/صورتحساب) رندر می‌شود
router.get('/jobs/:id/image', wrap(async (req, res) => {
  const [[job]] = await pool.query('SELECT kind, ref_id, payload FROM print_jobs WHERE id = ?', [req.params.id]);
  if (!job) throw new AppError(404, 'کار چاپ یافت نشد');
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : (job.payload || {});
  let png;
  if (job.kind === 'receipt') {
    png = await renderElementToPng(`/receipt.html?id=${job.ref_id}`, '#card');
  } else if (job.kind === 'waybill') {
    png = await renderElementToPng(`/waybill.html?id=${job.ref_id}`, '#card');
  } else if (job.kind === 'statement') {
    png = await renderElementToPng(`/statement.html?${payload.query || ''}`, '#receipt');
  } else if (job.kind === 'manifest') {
    png = await renderElementToPng('/manifest.html', '#card');
  } else {
    // test و سایر: از تمپلیت خودبسندهٔ حرارتی
    png = await renderHtmlToPng(await docHTML(payload), 576);
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.send(png);
}));

// اعلام موفقیتِ چاپ
router.post('/jobs/:id/done', wrap(async (req, res) => {
  await pool.query("UPDATE print_jobs SET status='done', printed_at=NOW(), error=NULL WHERE id=?", [req.params.id]);
  res.json({ ok: true });
}));

// اعلام خطای چاپ (تا ۳ بار دوباره در صف قرار می‌گیرد، بعد error می‌شود)
router.post('/jobs/:id/error', wrap(async (req, res) => {
  const msg = String(req.body?.error || 'خطای چاپ').slice(0, 250);
  const [[job]] = await pool.query('SELECT attempts FROM print_jobs WHERE id=?', [req.params.id]);
  if (job && job.attempts < 3) {
    await pool.query("UPDATE print_jobs SET status='queued', error=? WHERE id=?", [msg, req.params.id]);
    res.json({ ok: true, requeued: true });
  } else {
    await pool.query("UPDATE print_jobs SET status='error', error=? WHERE id=?", [msg, req.params.id]);
    res.json({ ok: true, requeued: false });
  }
}));

// ردیف‌های «بدهی گذشته» و «پرداختی» برای چاپِ سبک (مبالغ ریال؛ ایجنت «ریال» چاپ می‌کند)
async function addDebtRows(job, payload) {
  const [[rc]] = job.kind === 'receipt'
    ? await pool.query('SELECT * FROM receipts WHERE id=?', [job.ref_id])
    : await pool.query('SELECT * FROM receipts WHERE order_id=? ORDER BY id DESC LIMIT 1', [job.ref_id]);
  if (!rc) return;
  const a = await receiptAccount(rc);
  if (!a || a.previous == null) return;
  const oldDebt = -Number(a.previous || 0);      // مثبت = بدهی، منفی = طلب
  const invoice = -Number(a.effect || 0);        // اثرِ این فاکتور (+ خرید، − شیر)
  const paid = Number(a.paid || 0);
  const due = oldDebt + invoice - paid;          // کلِ قابل‌پرداخت بعد از این فاکتور
  if (!oldDebt && !paid) return;
  const items = Array.isArray(payload.items) ? payload.items : (payload.items = []);
  if (oldDebt > 0) items.push({ name: 'بدهی گذشته', qty: 1, unit: '', price: oldDebt, amount: oldDebt });
  else if (oldDebt < 0) items.push({ name: 'طلب گذشته (کم می‌شود)', qty: 1, unit: '', price: oldDebt, amount: oldDebt });
  if (paid) items.push({ name: 'پرداختی (کم می‌شود)', qty: 1, unit: '', price: -paid, amount: -paid });
  if (job.kind === 'waybill') {
    payload.total = due;                          // «جمع کل:» روی بارنامه
  } else {
    // فاکتور: «جمع بدهکار» شامل بدهیِ گذشته و «خالص فاکتور» = قابل‌پرداختِ کل
    payload.purchase_amount = Number(payload.purchase_amount || 0) + Math.max(oldDebt, 0);
    payload.net_amount = -due;
  }
}

export default router;
