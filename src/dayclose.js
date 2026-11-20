// بستنِ روز (Tagesabschluss): قفلِ روزانهٔ اسناد + خلاصهٔ روز.
// روز با تاریخِ میلادیِ 'YYYY-MM-DD' کلید می‌خورد و با DATE(...) مقایسه می‌شود.
import { AppError } from './util.js';

export function isValidDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day);
}

// آیا کلِ قابلیتِ «بستن روز» فعال است؟ (پیش‌فرض: فعال). پشتیبان می‌تواند خاموشش کند.
export async function dayCloseEnabled(runner) {
  const [[row]] = await runner.query(
    "SELECT value_json FROM settings WHERE scope='global' AND `key`='dayclose_enabled' LIMIT 1");
  if (!row) return true;
  try {
    const v = typeof row.value_json === 'string' ? JSON.parse(row.value_json) : row.value_json;
    return v !== false;
  } catch { return true; }
}

// آیا این روز بسته شده است؟ (branch خالی = سراسری)
// اگر کلِ قابلیت خاموش باشد، هیچ روزی قفل‌شده به‌حساب نمی‌آید.
export async function isDayClosed(runner, day, branchId = null) {
  if (!(await dayCloseEnabled(runner))) return false;
  const [[row]] = await runner.query(
    `SELECT id FROM day_closings
      WHERE day = ? AND status = 'closed' AND (branch_id = ? OR branch_id IS NULL) LIMIT 1`,
    [day, branchId]
  );
  return !!row;
}

// اگر روز بسته است، خطا بده (برای ویرایش/ابطال).
export async function assertDayOpen(runner, day, branchId = null) {
  if (await isDayClosed(runner, day, branchId)) {
    throw new AppError(409, `روز ${day} بسته شده است؛ برای تغییر باید ابتدا توسط پشتیبان بازگشایی شود.`);
  }
}

// روزِ (میلادیِ) یک رکورد از روی یک ستونِ زمانی — رشتهٔ 'YYYY-MM-DD'.
export async function recordDay(runner, table, dateColumn, id) {
  const [[r]] = await runner.query(
    `SELECT DATE_FORMAT(\`${dateColumn}\`, '%Y-%m-%d') AS day FROM \`${table}\` WHERE id = ?`,
    [id]
  );
  return r?.day || null;
}

// خلاصهٔ مالیِ یک روز: شیر ورودی، فروش، پرداخت‌ها، خالص.
export async function daySummary(runner, day) {
  const [[milk]] = await runner.query(
    `SELECT COALESCE(SUM(weight_kg),0) kg, COALESCE(SUM(amount),0) value,
            COUNT(*) cnt, COUNT(DISTINCT person_id) farmers
       FROM milk_deliveries WHERE DATE(delivered_at) = ? AND deleted_at IS NULL`, [day]);
  const [[tx]] = await runner.query(
    `SELECT
        COALESCE(SUM(CASE WHEN tx_type IN ('PRODUCT_SALE','FEED_SALE') THEN amount ELSE 0 END),0) sales,
        COALESCE(SUM(CASE WHEN tx_type = 'PAYMENT_OUT' THEN amount ELSE 0 END),0) paid_out,
        COALESCE(SUM(CASE WHEN tx_type = 'PAYMENT_IN'  THEN amount ELSE 0 END),0) received,
        COALESCE(SUM(CASE WHEN tx_type = 'CASH_WITHDRAWAL' THEN amount ELSE 0 END),0) withdrawals
       FROM transactions WHERE DATE(tx_date) = ? AND status = 'active'`, [day]);
  const [[rc]] = await runner.query(
    `SELECT COUNT(*) cnt FROM receipts WHERE DATE(issued_at) = ? AND voided_at IS NULL`, [day]);
  return {
    day,
    milk: { kg: Number(milk.kg), value: Number(milk.value), count: milk.cnt, farmers: milk.farmers },
    sales: Number(tx.sales),
    received: Number(tx.received),
    paid_out: Number(tx.paid_out),
    withdrawals: Number(tx.withdrawals),
    receipts: rc.cnt,
    // خالصِ جریانِ نقدِ روز: دریافت‌ها − پرداخت‌ها
    net_cash: Number(tx.received) - Number(tx.paid_out) - Number(tx.withdrawals),
  };
}
