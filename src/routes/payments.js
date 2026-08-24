import { Router } from 'express';
import { pool, withTx } from '../db.js';
import { postTransaction } from '../ledger.js';
import { AppError, wrap, currentJalaliMonth } from '../util.js';

const router = Router();

// ثبت پرداخت
//  direction=out  → پرداخت پول به دامدار (تسویه/علی‌الحساب)
//  direction=in   → دریافت پول از مشتری
//  kind=withdrawal → برداشت نقدی دامدار (نوع CASH_WITHDRAWAL)
router.post('/', wrap(async (req, res) => {
  const { person_id, direction, amount, method = 'cash', ref_no, note, kind, branch_id } = req.body;
  if (!person_id || !direction || !amount) throw new AppError(400, 'شخص، جهت و مبلغ لازم است');
  if (!['in', 'out'].includes(direction)) throw new AppError(400, 'جهت نامعتبر');

  const result = await withTx(async (conn) => {
    const [p] = await conn.query(
      `INSERT INTO payments (branch_id, person_id, direction, method, amount, ref_no, note, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [branch_id || null, person_id, direction, method, amount, ref_no || null, note || null, req.user?.uid || null]
    );
    let txType, desc;
    if (kind === 'withdrawal') { txType = 'CASH_WITHDRAWAL'; desc = 'برداشت نقدی'; }
    else if (direction === 'out') { txType = 'PAYMENT_OUT'; desc = note || 'پرداخت به دامدار'; }
    else { txType = 'PAYMENT_IN'; desc = note || 'دریافت از مشتری'; }

    await postTransaction(conn, {
      personId: person_id, txType, amount,
      sourceType: 'payment', sourceId: p.insertId, description: desc,
      branchId: branch_id || null, userId: req.user?.uid, month: currentJalaliMonth(),
    });
    return { id: p.insertId };
  });
  res.status(201).json(result);
}));

// دریافت کالا از شخص بابت پرداخت بدهی (مثلاً دامداری که قرض گرفته و با کالا پس می‌دهد)
//  → بستانکارِ شخص (بدهی او به شرکت کم می‌شود)
router.post('/goods-in', wrap(async (req, res) => {
  const { person_id, amount, description, branch_id } = req.body;
  if (!person_id || !amount || Number(amount) <= 0) throw new AppError(400, 'شخص و مبلغ لازم است');
  const result = await withTx(async (conn) => {
    const txId = await postTransaction(conn, {
      personId: person_id, txType: 'GOODS_IN', amount: Math.round(Number(amount)),
      sourceType: 'manual', sourceId: null,
      description: description || 'دریافت کالا بابت پرداخت بدهی',
      branchId: branch_id || null, userId: req.user?.uid, month: currentJalaliMonth(),
    });
    const [[bal]] = await conn.query('SELECT current_balance FROM account_balances WHERE person_id = ?', [person_id]);
    return { id: txId, balance: Number(bal?.current_balance || 0) };
  });
  res.status(201).json(result);
}));

// تسویهٔ کامل: پرداخت کل ماندهٔ قابل‌پرداخت به دامدار
router.post('/settle', wrap(async (req, res) => {
  const { person_id, method = 'cash', branch_id } = req.body;
  const result = await withTx(async (conn) => {
    const [[bal]] = await conn.query('SELECT current_balance FROM account_balances WHERE person_id = ?', [person_id]);
    const cb = Number(bal?.current_balance || 0);
    if (cb <= 0) throw new AppError(400, 'ماندهٔ قابل پرداختی وجود ندارد');

    const [p] = await conn.query(
      `INSERT INTO payments (branch_id, person_id, direction, method, amount, note, created_by)
       VALUES (?,?, 'out', ?, ?, 'تسویهٔ کامل', ?)`,
      [branch_id || null, person_id, method, cb, req.user?.uid || null]
    );
    await postTransaction(conn, {
      personId: person_id, txType: 'PAYMENT_OUT', amount: cb,
      sourceType: 'payment', sourceId: p.insertId, description: 'تسویهٔ کامل',
      branchId: branch_id || null, userId: req.user?.uid, month: currentJalaliMonth(),
    });
    await conn.query('UPDATE account_balances SET last_settlement_at = NOW() WHERE person_id = ?', [person_id]);
    return { paid: cb };
  });
  res.json(result);
}));

// ابطال تراکنش (به‌جای حذف): یک تراکنش معکوس + علامت voided
router.post('/void/:txId', wrap(async (req, res) => {
  const { txId } = req.params;
  const { reason } = req.body;
  await withTx(async (conn) => {
    const [[tx]] = await conn.query('SELECT * FROM transactions WHERE id = ? AND status="active"', [txId]);
    if (!tx) throw new AppError(404, 'تراکنش فعال یافت نشد');
    if (tx.is_locked) throw new AppError(400, 'تراکنش در ماه بسته‌شده قابل ابطال نیست');

    const revDir = tx.direction === 'credit' ? 'debit' : 'credit';
    await conn.query(
      `INSERT INTO transactions
         (branch_id, person_id, tx_type, direction, amount, year_month_jalali,
          source_type, source_id, description, reverses_tx_id, created_by)
       VALUES (?,?, 'VOID', ?, ?, ?, 'manual', ?, ?, ?, ?)`,
      [tx.branch_id, tx.person_id, revDir, tx.amount, tx.year_month_jalali,
       tx.id, `ابطال #${tx.id}: ${reason || ''}`, tx.id, req.user?.uid || null]
    );
    await conn.query('UPDATE transactions SET status="voided" WHERE id = ?', [txId]);
    await conn.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, old_json, user_id, reason)
       VALUES ('transactions', ?, 'void', ?, ?, ?)`,
      [tx.id, JSON.stringify(tx), req.user?.uid || null, reason || null]
    );
    const { recomputeBalance } = await import('../ledger.js');
    await recomputeBalance(conn, tx.person_id);
  });
  res.json({ ok: true });
}));

export default router;
