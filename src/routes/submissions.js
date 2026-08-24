// فاکتورهای فروش ارسالیِ اشخاص (خرید از آنها) — نمایش، تأیید، رد توسط کارمند
import { Router } from 'express';
import { pool, withTx } from '../db.js';
import { staffRequired } from '../auth.js';
import { postTransaction } from '../ledger.js';
import { AppError, wrap, toJalaliDate, currentJalaliMonth } from '../util.js';

const router = Router();
router.use(staffRequired);

// تعداد در انتظار (برای نشان اعلان داشبورد)
router.get('/count', wrap(async (req, res) => {
  const [[r]] = await pool.query("SELECT COUNT(*) c FROM purchase_submissions WHERE status='pending'");
  res.json({ pending: r.c });
}));

// فهرست (پیش‌فرض در انتظار)
router.get('/', wrap(async (req, res) => {
  const status = req.query.status || 'pending';
  const [rows] = await pool.query(
    `SELECT s.id, s.amount, s.description, s.status, s.created_at, s.photo IS NOT NULL AS has_photo,
            p.fullname, p.person_code, p.mobile
       FROM purchase_submissions s JOIN persons p ON p.id = s.person_id
      WHERE s.status = ? ORDER BY s.id DESC LIMIT 200`, [status]);
  res.json(rows.map((r) => ({ id: r.id, amount: Number(r.amount), description: r.description, status: r.status,
    has_photo: !!r.has_photo, fullname: r.fullname, person_code: r.person_code, mobile: r.mobile,
    created_jalali: toJalaliDate(r.created_at) })));
}));

// عکس فاکتور
router.get('/:id/photo', wrap(async (req, res) => {
  const [[r]] = await pool.query('SELECT photo FROM purchase_submissions WHERE id = ?', [req.params.id]);
  if (!r) throw new AppError(404, 'یافت نشد');
  res.json({ photo: r.photo || null });
}));

// تأیید → ثبت خرید در حساب شخص (بستانکار = شرکت به او بدهکار)
router.post('/:id/approve', wrap(async (req, res) => {
  const out = await withTx(async (conn) => {
    const [[s]] = await conn.query("SELECT * FROM purchase_submissions WHERE id = ? AND status='pending' FOR UPDATE", [req.params.id]);
    if (!s) throw new AppError(404, 'فاکتور در انتظار یافت نشد');
    const txId = await postTransaction(conn, {
      personId: s.person_id, txType: 'PURCHASE', amount: s.amount,
      sourceType: 'manual', sourceId: s.id,
      description: 'خرید از شخص' + (s.description ? (' — ' + s.description) : ''),
      userId: req.user.uid, month: currentJalaliMonth(),
    });
    await conn.query("UPDATE purchase_submissions SET status='approved', approved_by=?, approved_at=NOW(), tx_id=? WHERE id=?",
      [req.user.uid || null, txId, s.id]);
    return { ok: true, tx_id: txId };
  });
  res.json(out);
}));

router.post('/:id/reject', wrap(async (req, res) => {
  const [r] = await pool.query("UPDATE purchase_submissions SET status='rejected', approved_by=?, approved_at=NOW() WHERE id=? AND status='pending'",
    [req.user.uid || null, req.params.id]);
  if (!r.affectedRows) throw new AppError(404, 'فاکتور در انتظار یافت نشد');
  res.json({ ok: true });
}));

export default router;
