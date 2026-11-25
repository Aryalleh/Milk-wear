// تبدیلِ یک‌بارهٔ «تومان → ریال» برای داده‌هایی که به خیالِ تومان ولی در فیلدِ ریالی ثبت شده‌اند.
// همهٔ مبالغِ انتخاب‌شده ×۱۰ می‌شوند تا در دیتابیس واقعاً «ریال» باشند؛ نمایش طبقِ تنظیمِ ریال/تومان است.
//  - فقط یک‌بار قابل اجراست (settings.rial_migration_done)؛ همه در یک تراکنشِ دیتابیس (یا همه یا هیچ).
//  - فاکتورها/کالاهایی که قبلاً تکی ×۱۰ شده‌اند (audit: fix_x10) دوباره ضرب نمی‌شوند.
//  - قفلِ روز/ماه نادیده گرفته می‌شود چون این اصلاحِ واحد است، نه تغییرِ سند.
import { recomputeBalance } from './ledger.js';

export const SCOPES = {
  invoices: 'فاکتورهای فروش (اقلام، ظرف، جمع، رسید، بدهی مشتری) + پرداخت‌هایی که هنگام ثبت/تحویلِ همان فاکتور زده شده',
  products: 'قیمت پایهٔ کالاها',
  payments: 'سایر پرداخت‌ها و دریافت‌ها (دریافت وجه، پرداخت به دامدار، تسویه، برداشت نقدی)',
  credits: 'اعتبار/هدیه، اصلاحِ دستی و ماندهٔ اول',
  milk: 'تحویل‌های شیر و قیمت ماهانهٔ شیر',
  packaging: 'قیمت ظرف‌ها و لایه‌های خرید ظرف',
  expenses: 'هزینه‌های کسب‌وکار و قالب‌هایشان',
};
export const DEFAULT_SCOPES = ['invoices', 'products'];

const inList = (ids) => (ids.length ? ids.map(Number).join(',') : 'NULL');

async function fixedIds(conn, entity) {
  const [r] = await conn.query("SELECT DISTINCT entity_id id FROM audit_logs WHERE entity_type=? AND action='fix_x10'", [entity]);
  return new Set(r.map((x) => Number(x.id)));
}

// همهٔ شناسه‌هایی که باید تغییر کنند (هم برای پیش‌نمایش، هم برای اجرا)
async function plan(conn, scopes) {
  const P = { orders: [], orderTx: [], payments: [], paymentTx: [], products: [], manualTx: [], milk: [], milkTx: [], sums: {} };
  const has = (s) => scopes.includes(s);

  if (has('invoices')) {
    const done = await fixedIds(conn, 'orders');
    const [orders] = await conn.query('SELECT id, order_no, person_id, ordered_at, total_amount FROM orders');
    P.orders = orders.filter((o) => !done.has(Number(o.id)));
    const oids = P.orders.map((o) => o.id);
    if (oids.length) {
      const [tx] = await conn.query(`SELECT id FROM transactions WHERE source_type='order' AND source_id IN (${inList(oids)})`);
      P.orderTx = tx.map((t) => t.id);
      // پرداخت‌های هم‌زمان با ثبت/تحویلِ فاکتور (لینک مستقیم ندارند)
      const pay = new Set();
      for (const o of P.orders) {
        const [rows] = await conn.query(
          `SELECT p.id FROM payments p
            WHERE p.person_id=? AND p.direction='in' AND (
                  (p.note IN ('دریافت هنگام فروش','فروش فروشگاهی') AND ABS(TIMESTAMPDIFF(SECOND, p.paid_at, ?)) <= 10)
               OR p.id IN (SELECT t.source_id FROM transactions t WHERE t.source_type='payment' AND t.description=?)
               OR p.id = (SELECT rc.payment_id FROM receipts rc WHERE rc.order_id=? LIMIT 1))`,
          [o.person_id, o.ordered_at, `دریافت هنگام تحویل سفارش ${o.order_no}`, o.id]);
        rows.forEach((r) => pay.add(Number(r.id)));
      }
      P.payments = [...pay];
    }
    P.sums.invoices = P.orders.reduce((s, o) => s + Number(o.total_amount), 0);
  }
  if (has('payments')) {
    const [rows] = await conn.query(`SELECT id FROM payments WHERE id NOT IN (${inList(P.payments)})`);
    P.payments = P.payments.concat(rows.map((r) => Number(r.id)));
  }
  if (P.payments.length) {
    const [tx] = await conn.query(`SELECT id FROM transactions WHERE source_type='payment' AND source_id IN (${inList(P.payments)})`);
    P.paymentTx = tx.map((t) => t.id);
  }
  if (has('products')) {
    const done = await fixedIds(conn, 'products');
    const [rows] = await conn.query('SELECT id, base_price FROM products');
    P.products = rows.filter((p) => !done.has(Number(p.id)));
  }
  if (has('credits')) {
    const [tx] = await conn.query("SELECT id FROM transactions WHERE tx_type IN ('ADJUSTMENT','OPENING_BALANCE','REFUND') AND source_type='manual'");
    P.manualTx = tx.map((t) => t.id);
  }
  if (has('milk')) {
    const [m] = await conn.query('SELECT id FROM milk_deliveries');
    P.milk = m.map((r) => r.id);
    const [tx] = await conn.query("SELECT id FROM transactions WHERE source_type='milk_delivery'");
    P.milkTx = tx.map((t) => t.id);
  }
  return P;
}

async function count(conn, sql) { try { const [[r]] = await conn.query(sql); return Number(r.c || 0); } catch { return 0; } }

export async function previewMigration(conn, scopes = DEFAULT_SCOPES) {
  const P = await plan(conn, scopes);
  const out = {
    invoices: { count: P.orders.length, total: P.sums.invoices || 0, payments: scopes.includes('invoices') ? P.payments.length : 0 },
    products: { count: P.products.length },
    payments: { count: scopes.includes('payments') ? P.payments.length : 0 },
    credits: { count: P.manualTx.length },
    milk: { count: P.milk.length },
    packaging: { count: scopes.includes('packaging') ? await count(conn, 'SELECT COUNT(*) c FROM packagings') : 0 },
    expenses: { count: scopes.includes('expenses') ? await count(conn, 'SELECT COUNT(*) c FROM expenses') : 0 },
  };
  return out;
}

export async function runMigration(conn, scopes = DEFAULT_SCOPES) {
  const P = await plan(conn, scopes);
  const has = (s) => scopes.includes(s);
  const n = {};
  const x10 = async (key, sql) => { const [r] = await conn.query(sql); n[key] = (n[key] || 0) + r.affectedRows; };

  // تراکنش‌ها + ردیف‌های VOIDِ معکوسِ آن‌ها
  const tx = [...new Set([...P.orderTx, ...P.paymentTx, ...P.manualTx, ...P.milkTx].map(Number))];
  if (tx.length) {
    await x10('transactions', `UPDATE transactions SET amount=amount*10 WHERE id IN (${inList(tx)})`);
    await x10('transactions_void', `UPDATE transactions SET amount=amount*10 WHERE tx_type='VOID' AND reverses_tx_id IN (${inList(tx)})`);
  }
  if (P.orders.length) {
    const ids = inList(P.orders.map((o) => o.id));
    await x10('order_items', `UPDATE order_items SET unit_price=unit_price*10, amount=amount*10, packaging_cost=COALESCE(packaging_cost,0)*10 WHERE order_id IN (${ids})`);
    await x10('orders', `UPDATE orders SET total_amount=total_amount*10, paid_amount=paid_amount*10 WHERE id IN (${ids})`);
    await x10('receipts_purchase', `UPDATE receipts SET purchase_amount=purchase_amount*10 WHERE order_id IN (${ids})`);
  }
  if (P.payments.length) await x10('payments', `UPDATE payments SET amount=amount*10 WHERE id IN (${inList(P.payments)})`);
  if (P.products.length) await x10('products', `UPDATE products SET base_price=base_price*10 WHERE id IN (${inList(P.products.map((p) => p.id))})`);
  if (has('milk')) {
    await x10('milk_deliveries', 'UPDATE milk_deliveries SET price_per_kg=price_per_kg*10, amount=amount*10');
    await x10('milk_price_history', 'UPDATE milk_price_history SET price_per_kg=price_per_kg*10');
    await x10('receipts_milk', 'UPDATE receipts SET milk_amount=milk_amount*10');
  }
  if (has('packaging')) {
    await x10('packagings', 'UPDATE packagings SET default_price=default_price*10');
    try { await x10('packaging_layers', 'UPDATE packaging_layers SET unit_price=unit_price*10'); } catch { /* جدول نیست */ }
    try { await x10('packaging_consumptions', 'UPDATE packaging_consumptions SET cost=cost*10'); } catch { /* جدول نیست */ }
  }
  if (has('expenses')) {
    try { await x10('expenses', 'UPDATE expenses SET amount=amount*10'); } catch { /* جدول نیست */ }
    try { await x10('expense_templates', 'UPDATE expense_templates SET default_amount=default_amount*10'); } catch { /* جدول نیست */ }
  }
  // رسیدها: خالص و ماندهٔ چاپ‌شده با مقیاسِ جدید
  if (P.orders.length || has('milk')) {
    await conn.query('UPDATE receipts SET net_amount = milk_amount - purchase_amount');
    await x10('receipts_balance', 'UPDATE receipts SET balance_after=balance_after*10');
  }
  // بازمحاسبهٔ ماندهٔ همهٔ اشخاص
  const [persons] = await conn.query('SELECT DISTINCT person_id FROM transactions');
  for (const { person_id } of persons) await recomputeBalance(conn, person_id);
  n.balances = persons.length;
  return n;
}
