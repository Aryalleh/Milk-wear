import { currentJalaliMonth, toJalaliDate } from './util.js';

// شمارهٔ سفارش روزانه و ساده برای راننده: مثل 14050603-3 (تاریخ شمسی + شمارهٔ روز)
export async function nextOrderNo(conn) {
  const [[r]] = await conn.query('SELECT COUNT(*) AS c FROM orders WHERE DATE(ordered_at)=CURDATE()');
  const seq = Number(r.c) + 1;
  const jd = toJalaliDate(new Date()).replace(/\//g, '');
  return `${jd}-${seq}`;
}

// جهت پیش‌فرض هر نوع تراکنش نسبت به شخص
// credit = شرکت به شخص بدهکار می‌شود (بستانکاریِ شخص) | debit = شخص به شرکت بدهکار
const DEFAULT_DIRECTION = {
  MILK_DELIVERY: 'credit',
  PRODUCT_SALE: 'debit',
  FEED_SALE: 'debit',
  CASH_WITHDRAWAL: 'debit',
  PAYMENT_OUT: 'debit',     // پرداخت پول به دامدار → بدهی شرکت کم می‌شود
  PAYMENT_IN: 'credit',     // دریافت پول از مشتری → بدهی مشتری کم می‌شود
  OPENING_BALANCE: 'credit',
  ADJUSTMENT: 'credit',
  REFUND: 'credit',
  VOID: 'credit',
  PURCHASE: 'credit',   // خرید از شخص → شرکت به او بدهکار می‌شود
};

/**
 * ثبت یک تراکنش در دفتر کل + به‌روزرسانی کَش مانده. باید داخل withTx فراخوانی شود.
 * @param {import('mysql2/promise').PoolConnection} conn
 */
export async function postTransaction(conn, {
  personId, txType, amount, sourceType, sourceId,
  description, direction, branchId = null, userId = null, month = null,
}) {
  const dir = direction || DEFAULT_DIRECTION[txType];
  if (!dir) throw new Error(`جهت نامشخص برای نوع تراکنش: ${txType}`);
  const ym = month || currentJalaliMonth();

  // جلوگیری از ثبت در ماه بسته‌شده
  const [[closed]] = await conn.query(
    `SELECT id FROM month_closings
      WHERE year_month_jalali = ? AND status='closed'
        AND (branch_id = ? OR branch_id IS NULL) LIMIT 1`,
    [ym, branchId]
  );
  if (closed) throw new Error(`ماه ${ym} بسته شده است؛ ثبت تراکنش ممکن نیست.`);

  const [r] = await conn.query(
    `INSERT INTO transactions
       (branch_id, person_id, tx_type, direction, amount, year_month_jalali,
        source_type, source_id, description, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [branchId, personId, txType, dir, amount, ym, sourceType, sourceId || null, description || null, userId]
  );

  await recomputeBalance(conn, personId);
  return r.insertId;
}

/**
 * بازمحاسبهٔ کامل کَش مانده از روی جدول‌های پایه (منبع حقیقت).
 * ساده و قابل‌اعتماد: هر بار از صفر محاسبه می‌شود.
 */
export async function recomputeBalance(conn, personId) {
  const ym = currentJalaliMonth();

  const [[bal]] = await conn.query(
    `SELECT
        COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END),0) AS current_balance,
        COALESCE(SUM(CASE WHEN tx_type IN ('PRODUCT_SALE','FEED_SALE') THEN amount ELSE 0 END),0) AS purchases_total,
        COALESCE(SUM(CASE WHEN tx_type='CASH_WITHDRAWAL' THEN amount ELSE 0 END),0) AS cash_withdrawal_total,
        COALESCE(SUM(CASE WHEN tx_type IN ('PAYMENT_OUT','PAYMENT_IN') THEN amount ELSE 0 END),0) AS payments_total,
        COALESCE(SUM(CASE WHEN tx_type='MILK_DELIVERY' THEN amount ELSE 0 END),0) AS milk_value_total,
        MAX(CASE WHEN tx_type IN ('PAYMENT_OUT','PAYMENT_IN') THEN tx_date END) AS last_payment_at
     FROM transactions
     WHERE person_id = ? AND status='active'`,
    [personId]
  );

  const [[milk]] = await conn.query(
    `SELECT COALESCE(SUM(weight_kg),0) AS kg, COALESCE(SUM(amount),0) AS val
       FROM milk_deliveries
      WHERE person_id = ? AND year_month_jalali = ? AND deleted_at IS NULL`,
    [personId, ym]
  );

  const [[lastOrder]] = await conn.query(
    `SELECT MAX(ordered_at) AS t FROM orders WHERE person_id = ? AND deleted_at IS NULL`,
    [personId]
  );

  const cb = Number(bal.current_balance);
  const status = cb > 0 ? 'creditor' : cb < 0 ? 'debtor' : 'settled';

  await conn.query(
    `INSERT INTO account_balances
       (person_id, current_balance, milk_kg_month, milk_value_month, milk_value_total,
        purchases_total, cash_withdrawal_total, payments_total, last_payment_at, last_order_at, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
        current_balance=VALUES(current_balance),
        milk_kg_month=VALUES(milk_kg_month),
        milk_value_month=VALUES(milk_value_month),
        milk_value_total=VALUES(milk_value_total),
        purchases_total=VALUES(purchases_total),
        cash_withdrawal_total=VALUES(cash_withdrawal_total),
        payments_total=VALUES(payments_total),
        last_payment_at=VALUES(last_payment_at),
        last_order_at=VALUES(last_order_at),
        status=VALUES(status)`,
    [personId, cb, milk.kg, milk.val, bal.milk_value_total,
     bal.purchases_total, bal.cash_withdrawal_total, bal.payments_total,
     bal.last_payment_at, lastOrder.t, status]
  );

  return cb;
}

/**
 * قیمت شیر برای یک شخص در یک ماه: ابتدا قیمت اختصاصی، سپس قیمت عمومی ماه.
 */
export async function resolveMilkPrice(conn, personId, month) {
  const [rows] = await conn.query(
    `SELECT price_per_kg FROM milk_price_history
      WHERE year_month_jalali = ? AND (person_id = ? OR person_id IS NULL)
      ORDER BY person_id IS NULL ASC LIMIT 1`,
    [month, personId]
  );
  return rows.length ? Number(rows[0].price_per_kg) : null;
}
