import { pool } from '../db.js';
import { jalaliYearMonth } from '../util.js';

// ثبت یک تراکنش در دفتر کل. حتماً درون یک تراکنش دیتابیس (conn) صدا زده می‌شود.
export async function postTransaction(conn, t) {
  const [r] = await conn.execute(
    `INSERT INTO transactions
       (person_id, tx_type, direction, amount, period_ym, source_type, source_id, description, created_by)
     VALUES (:person_id,:tx_type,:direction,:amount,:period_ym,:source_type,:source_id,:description,:created_by)`,
    {
      person_id: t.person_id,
      tx_type: t.tx_type,
      direction: t.direction,
      amount: t.amount,
      period_ym: t.period_ym || jalaliYearMonth(),
      source_type: t.source_type,
      source_id: t.source_id ?? null,
      description: t.description,
      created_by: t.created_by ?? null,
    }
  );
  return r.insertId;
}

// خلاصه حساب یک شخص — دادهٔ داشبورد و عدد «قابل پرداخت»
export async function personSummary(personId) {
  const ym = jalaliYearMonth();

  const [[bal]] = await pool.execute(
    `SELECT
       COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END),0) AS balance,
       COALESCE(SUM(CASE WHEN tx_type IN ('PRODUCT_SALE','FEED_SALE') THEN amount ELSE 0 END),0) AS purchases_total,
       COALESCE(SUM(CASE WHEN tx_type='CASH_WITHDRAWAL' THEN amount ELSE 0 END),0) AS cash_withdrawal_total,
       COALESCE(SUM(CASE WHEN tx_type IN ('PAYMENT_IN','PAYMENT_OUT') THEN amount ELSE 0 END),0) AS payments_total
     FROM transactions WHERE person_id=:pid AND status='active'`,
    { pid: personId }
  );

  const [[milk]] = await pool.execute(
    `SELECT
       COALESCE(SUM(weight_kg),0) AS milk_kg_total,
       COALESCE(SUM(amount),0)    AS milk_value_total,
       COALESCE(SUM(CASE WHEN period_ym=:ym THEN weight_kg ELSE 0 END),0) AS milk_kg_month,
       COALESCE(SUM(CASE WHEN period_ym=:ym THEN amount    ELSE 0 END),0) AS milk_value_month
     FROM milk_deliveries WHERE person_id=:pid`,
    { pid: personId, ym }
  );

  const [[lastPay]] = await pool.execute(
    `SELECT MAX(paid_at) AS last_payment_at FROM payments WHERE person_id=:pid`,
    { pid: personId }
  );
  const [[lastOrder]] = await pool.execute(
    `SELECT MAX(ordered_at) AS last_order_at FROM orders WHERE person_id=:pid`,
    { pid: personId }
  );

  const balance = Number(bal.balance);
  const status = balance > 0 ? 'creditor' : balance < 0 ? 'debtor' : 'settled';

  return {
    balance,
    payable_now: balance > 0 ? balance : 0,        // قابل پرداخت به دامدار
    receivable_now: balance < 0 ? -balance : 0,    // قابل دریافت از مشتری
    status,
    milk_kg_month: Number(milk.milk_kg_month),
    milk_value_month: Number(milk.milk_value_month),
    milk_kg_total: Number(milk.milk_kg_total),
    milk_value_total: Number(milk.milk_value_total),
    purchases_total: Number(bal.purchases_total),
    cash_withdrawal_total: Number(bal.cash_withdrawal_total),
    payments_total: Number(bal.payments_total),
    last_payment_at: lastPay.last_payment_at,
    last_order_at: lastOrder.last_order_at,
  };
}

// گردش حساب با مانده رونده (مثل صورت‌حساب بانکی)
export async function personLedger(personId) {
  const [rows] = await pool.execute(
    `SELECT
       id, tx_date, description, tx_type,
       CASE WHEN direction='debit'  THEN amount ELSE 0 END AS debit,
       CASE WHEN direction='credit' THEN amount ELSE 0 END AS credit,
       SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END)
         OVER (ORDER BY tx_date, id) AS running_balance
     FROM transactions
     WHERE person_id=:pid AND status='active'
     ORDER BY tx_date, id`,
    { pid: personId }
  );
  return rows;
}
