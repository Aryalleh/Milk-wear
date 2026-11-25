import { Router } from 'express';
import crypto from 'crypto';
import { pool, withTx } from '../db.js';
import { postTransaction, resolveMilkPrice, recomputeBalance, nextOrderNo, voidTransactionsBySource } from '../ledger.js';
import { assertDayOpen, recordDay } from '../dayclose.js';
import { notifyReceipt } from '../bale.js';
import { enqueueReceipt } from '../print.js';
import { AppError, wrap, currentJalaliMonth, toJalaliDate, toJalaliDateTime } from '../util.js';

const router = Router();

// ثبت فاکتور ترکیبی: تحویل شیر + خرید کالا در یک سند
// body: { person_id, branch_id, warehouse_id,
//         milk: { shift, weight_kg, price_per_kg? },
//         items: [{ product_id, quantity, unit_price? }], note }
router.post('/', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'فقط کارمندان می‌توانند فاکتور ثبت کنند');
  const { person_id, branch_id, warehouse_id, milk, items = [], note,
          channel = 'farmer', paid = false, payment_method = 'cash', print = false } = req.body;
  if (!person_id) throw new AppError(400, 'شخص لازم است');
  const hasMilk = milk && milk.shift && Number(milk.weight_kg) > 0;
  const hasItems = Array.isArray(items) && items.length > 0;
  if (!hasMilk && !hasItems) throw new AppError(400, 'حداقل تحویل شیر یا یک قلم خرید لازم است');

  const month = currentJalaliMonth();
  const uid = req.user?.uid || null;

  const receipt = await withTx(async (conn) => {
    let milkAmount = 0, milkDeliveryId = null, milkPrice = null;
    let purchaseAmount = 0, orderId = null, paymentId = null;

    // --- بخش شیر (بستانکار) ---
    if (hasMilk) {
      milkPrice = milk.price_per_kg != null
        ? Number(milk.price_per_kg)
        : await resolveMilkPrice(conn, person_id, month);
      if (milkPrice == null) throw new AppError(400, `قیمت شیر برای ماه ${month} تعریف نشده است`);
      milkAmount = Math.round(Number(milk.weight_kg) * milkPrice);

      const [d] = await conn.query(
        `INSERT INTO milk_deliveries
           (branch_id, person_id, shift, year_month_jalali, weight_kg, fat_pct, price_per_kg, amount, note, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [branch_id || null, person_id, milk.shift, month, milk.weight_kg, milk.fat_pct || null, milkPrice, milkAmount, note || null, uid]
      );
      milkDeliveryId = d.insertId;
      const label = milk.shift === 'morning' ? 'شیر صبح' : 'شیر شب';
      await postTransaction(conn, {
        personId: person_id, txType: 'MILK_DELIVERY', amount: milkAmount,
        sourceType: 'milk_delivery', sourceId: milkDeliveryId,
        description: `${label} — ${milk.weight_kg} کیلو × ${milkPrice.toLocaleString('fa')}`,
        branchId: branch_id || null, userId: uid, month,
      });
    }

    // --- بخش خرید (بدهکار) ---
    let lines = [];
    if (hasItems) {
      for (const it of items) {
        const [[prod]] = await conn.query('SELECT * FROM products WHERE id = ?', [it.product_id]);
        if (!prod) throw new AppError(400, `کالا یافت نشد: ${it.product_id}`);
        const price = it.unit_price != null ? Number(it.unit_price) : Number(prod.base_price);
        const amount = Math.round(price * Number(it.quantity));
        purchaseAmount += amount;
        lines.push({ prod, quantity: Number(it.quantity), price, amount });
      }
      const orderNo = await nextOrderNo(conn);
      // خریدِ دامدار حضوری است (درجا تحویل)، پس به لیست ارسال/بارگیری نمی‌رود
      const [o] = await conn.query(
        `INSERT INTO orders (branch_id, order_no, person_id, channel, fulfillment_type, status, warehouse_id, total_amount, note, created_by)
         VALUES (?,?,?, ?, 'pickup', 'delivered', ?,?,?,?)`,
        [branch_id || null, orderNo, person_id, channel, warehouse_id || null, purchaseAmount, note || null, uid]
      );
      orderId = o.insertId;
      for (const ln of lines) {
        await conn.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price, amount) VALUES (?,?,?,?,?)`,
          [orderId, ln.prod.id, ln.quantity, ln.price, ln.amount]
        );
        if (ln.prod.track_stock && warehouse_id) {
          await conn.query(
            `INSERT INTO stock_movements
               (branch_id, warehouse_id, product_id, direction, quantity, source_type, source_id, created_by)
             VALUES (?,?,?, 'out', ?, 'sale', ?, ?)`,
            [branch_id || null, warehouse_id, ln.prod.id, ln.quantity, orderId, uid]
          );
          await conn.query(
            `INSERT INTO stock_balances (warehouse_id, product_id, quantity, last_movement_at)
             VALUES (?,?,?, NOW())
             ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), last_movement_at = NOW()`,
            [warehouse_id, ln.prod.id, -ln.quantity]
          );
        }
      }
      const hasFeed = lines.some((l) => l.prod.category_id === 2);
      await postTransaction(conn, {
        personId: person_id, txType: hasFeed ? 'FEED_SALE' : 'PRODUCT_SALE', amount: purchaseAmount,
        sourceType: 'order', sourceId: orderId,
        description: lines.map((l) => `${l.prod.name}×${l.quantity}`).join('، '),
        branchId: branch_id || null, userId: uid, month,
      });

      // پرداخت نقدی/کارت هم‌زمان (فروش فروشگاهی) → دریافت از مشتری، مانده صفر می‌شود
      if (paid && purchaseAmount > 0) {
        const [pay] = await conn.query(
          `INSERT INTO payments (branch_id, person_id, direction, method, amount, note, created_by)
           VALUES (?,?, 'in', ?, ?, 'فروش فروشگاهی', ?)`,
          [branch_id || null, person_id, payment_method, purchaseAmount, uid]);
        paymentId = pay.insertId;
        await postTransaction(conn, {
          personId: person_id, txType: 'PAYMENT_IN', amount: purchaseAmount,
          sourceType: 'payment', sourceId: pay.insertId, description: 'دریافت فروش فروشگاهی',
          branchId: branch_id || null, userId: uid, month,
        });
      }
    }

    // --- مانده کل حساب پس از این فاکتور ---
    const balanceAfter = await recomputeBalance(conn, person_id);
    const netAmount = milkAmount - purchaseAmount;
    const receiptNo = `RC${Date.now().toString().slice(-10)}`;
    const token = crypto.randomBytes(16).toString('hex');

    const [rc] = await conn.query(
      `INSERT INTO receipts
         (branch_id, receipt_no, public_token, person_id, year_month_jalali, milk_delivery_id, order_id, payment_id,
          milk_amount, purchase_amount, net_amount, balance_after, note, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [branch_id || null, receiptNo, token, person_id, month, milkDeliveryId, orderId, paymentId,
       milkAmount, purchaseAmount, netAmount, balanceAfter, note || null, uid]
    );
    return { id: rc.insertId, receipt_no: receiptNo, public_token: token, order_id: orderId,
             milk_amount: milkAmount, purchase_amount: purchaseAmount,
             net_amount: netAmount, balance_after: balanceAfter };
  });

  // چاپ رسید دلبخواهی است؛ فقط اگر print=true باشد به صف چاپ می‌رود
  if (print) enqueueReceipt(receipt.id).catch((e) => console.error('enqueueReceipt:', e.message));

  // اطلاع‌رسانی به شخص در بله (در صورت اتصال حساب) + لینک فاکتور — بدون بلاک‌کردن پاسخ
  const [[person]] = await pool.query(
    'SELECT id, fullname, bale_user_id FROM persons WHERE id = ?', [person_id]);
  if (person?.bale_user_id) {
    notifyReceipt(person, receipt)
      .then((r) => { if (r?.ok) pool.query('UPDATE receipts SET notified_at = NOW() WHERE id = ?', [receipt.id]); })
      .catch(() => {});
  }

  res.status(201).json(receipt);
}));

// وضعیت حسابِ شخص روی فاکتور — زنده از دفتر حساب (بعد از ویرایش/لغو/تبدیل هم درست می‌ماند)
//  previous: ماندهٔ قبل از این فاکتور | effect: اثرِ خودِ فاکتور | paid: پرداختِ هنگامِ خرید | after: ماندهٔ بعد
//  علامت: منفی = شخص بدهکار، مثبت = بستانکار. current: ماندهٔ فعلیِ کلِ حساب.
async function receiptAccount(rc) {
  const conds = [], params = [];
  if (rc.order_id) { conds.push("(source_type='order' AND source_id=?)"); params.push(rc.order_id); }
  if (rc.milk_delivery_id) { conds.push("(source_type='milk_delivery' AND source_id=?)"); params.push(rc.milk_delivery_id); }
  if (rc.payment_id) { conds.push("(source_type='payment' AND source_id=?)"); params.push(rc.payment_id); }
  const signed = "COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END),0)";
  const [[cur]] = await pool.query('SELECT current_balance FROM account_balances WHERE person_id=?', [rc.person_id]);
  const current = Number(cur?.current_balance || 0);
  if (!conds.length) return { previous: null, effect: 0, paid: 0, after: null, current };
  // جایگاهِ فاکتور در دفتر: اولین تراکنشِ منابعش (حتی اگر بعداً ویرایش/باطل شده باشد)
  const [[anc]] = await pool.query(`SELECT MIN(id) id FROM transactions WHERE person_id=? AND (${conds.join(' OR ')})`, [rc.person_id, ...params]);
  if (!anc?.id) return { previous: null, effect: 0, paid: 0, after: null, current };
  const [[bf]] = await pool.query(`SELECT ${signed} b FROM transactions WHERE person_id=? AND status='active' AND id < ?`, [rc.person_id, anc.id]);
  const [[ef]] = await pool.query(`SELECT ${signed} e FROM transactions WHERE person_id=? AND status='active' AND (${conds.join(' OR ')})`, [rc.person_id, ...params]);
  let paid = 0;
  if (rc.order_id && !rc.payment_id) {
    const [[o]] = await pool.query("SELECT paid_amount, status FROM orders WHERE id=?", [rc.order_id]);
    if (o && o.status !== 'canceled') paid = Number(o.paid_amount || 0);
  }
  let effect = Number(ef.e);
  if (rc.payment_id) {   // پرداختِ همراهِ فاکتور (دامدار/فروشگاه) جدا نمایش داده می‌شود
    const [[pp]] = await pool.query(`SELECT ${signed} p FROM transactions WHERE status='active' AND source_type='payment' AND source_id=?`, [rc.payment_id]);
    paid = Number(pp.p); effect -= paid;
  }
  const previous = Number(bf.b);
  return { previous, effect, paid, after: previous + effect + paid, current };
}

// ساخت نمای کامل فاکتور از روی رکورد (مشترک بین نمای کارمند و عمومی)
export async function buildReceiptView(rc) {
  if (!rc.public_token) {
    rc.public_token = crypto.randomBytes(16).toString('hex');
    await pool.query('UPDATE receipts SET public_token = ? WHERE id = ?', [rc.public_token, rc.id]);
  }
  const [[person]] = await pool.query(
    'SELECT id, person_code, fullname, mobile, address FROM persons WHERE id = ?', [rc.person_id]);
  const [[branch]] = await pool.query(
    'SELECT id, name, code, address, phone FROM branches WHERE id = ?', [rc.branch_id]);
  let milk = null;
  if (rc.milk_delivery_id) { const [[m]] = await pool.query('SELECT * FROM milk_deliveries WHERE id = ?', [rc.milk_delivery_id]); milk = m; }
  let items = [];
  if (rc.order_id) {
    const [rows] = await pool.query(
      `SELECT oi.*, p.name AS product_name, u.symbol AS unit FROM order_items oi
         JOIN products p ON p.id = oi.product_id LEFT JOIN units u ON u.id = p.unit_id WHERE oi.order_id = ?`, [rc.order_id]);
    items = rows;
  }
  const packaging_total = items.reduce((s, i) => s + Number(i.packaging_cost || 0), 0);
  const account = await receiptAccount(rc);
  return { receipt: { ...rc, issued_at_jalali: toJalaliDateTime(rc.issued_at) }, person, branch, milk, items, packaging_total, account };
}

// دریافت کامل یک فاکتور برای نمایش/پرینت (کارمند یا صاحب)
router.get('/:id', wrap(async (req, res) => {
  const [[rc]] = await pool.query('SELECT * FROM receipts WHERE id = ?', [req.params.id]);
  if (!rc) throw new AppError(404, 'فاکتور یافت نشد');
  if (req.user.kind !== 'staff' && rc.person_id !== req.user.person_id)
    throw new AppError(403, 'دسترسی مجاز نیست');
  res.json(await buildReceiptView(rc));
}));

// لیست فاکتورهای یک شخص یا سایت (کارمند)
router.get('/', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'دسترسی مجاز نیست');
  const { person_id, branch_id } = req.query;
  const where = [], params = [];
  if (person_id) { where.push('r.person_id = ?'); params.push(person_id); }
  if (branch_id) { where.push('r.branch_id = ?'); params.push(branch_id); }
  const [rows] = await pool.query(
    `SELECT r.id, r.receipt_no, r.issued_at, r.milk_amount, r.purchase_amount,
            r.net_amount, r.balance_after, r.voided_at, p.fullname,
            r.milk_delivery_id, md.weight_kg AS milk_weight_kg, md.price_per_kg AS milk_price_per_kg,
            EXISTS(SELECT 1 FROM day_closings dc
                     WHERE dc.day = DATE(r.issued_at) AND dc.status='closed'
                       AND (dc.branch_id = r.branch_id OR dc.branch_id IS NULL)) AS locked
       FROM receipts r JOIN persons p ON p.id = r.person_id
       LEFT JOIN milk_deliveries md ON md.id = r.milk_delivery_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY r.id DESC LIMIT 100`, params);
  res.json(rows);
}));

// ویرایش یادداشتِ فاکتور (ویرایشِ سبک) — فقط تا قبل از «بستن روز»
router.patch('/:id', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'دسترسی مجاز نیست');
  const id = req.params.id;
  const [[rc]] = await pool.query('SELECT * FROM receipts WHERE id = ?', [id]);
  if (!rc) throw new AppError(404, 'فاکتور یافت نشد');
  if (rc.voided_at) throw new AppError(409, 'فاکتورِ باطل‌شده قابل ویرایش نیست');
  const day = await recordDay(pool, 'receipts', 'issued_at', id);
  await assertDayOpen(pool, day, rc.branch_id);
  if (req.body.note !== undefined) {
    await pool.query('UPDATE receipts SET note = ? WHERE id = ?', [req.body.note || null, id]);
  }
  res.json({ ok: true });
}));

// ابطال کاملِ فاکتور — تراکنش‌های شیر/فروش/پرداخت معکوس و انبار بازگردانده می‌شود.
// فقط تا قبل از «بستن روز»؛ پس از بستن باید ابتدا توسط پشتیبان بازگشایی شود.
router.post('/:id/void', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'فقط کارمندان می‌توانند فاکتور باطل کنند');
  const id = req.params.id;
  const reason = req.body?.reason || 'ابطال فاکتور';
  const uid = req.user?.uid || null;

  await withTx(async (conn) => {
    const [[rc]] = await conn.query('SELECT * FROM receipts WHERE id = ?', [id]);
    if (!rc) throw new AppError(404, 'فاکتور یافت نشد');
    if (rc.voided_at) throw new AppError(409, 'این فاکتور قبلاً باطل شده است');
    const day = await recordDay(conn, 'receipts', 'issued_at', id);
    await assertDayOpen(conn, day, rc.branch_id);

    // شیر: ابطال تراکنش + حذفِ نرمِ رکورد
    if (rc.milk_delivery_id) {
      await voidTransactionsBySource(conn, { sourceType: 'milk_delivery', sourceId: rc.milk_delivery_id, userId: uid, reason });
      await conn.query('UPDATE milk_deliveries SET deleted_at = NOW() WHERE id = ?', [rc.milk_delivery_id]);
    }

    // خرید/فروش: ابطال تراکنش + بازگردانیِ انبار + لغو سفارش
    if (rc.order_id) {
      await voidTransactionsBySource(conn, { sourceType: 'order', sourceId: rc.order_id, userId: uid, reason });
      const [moves] = await conn.query(
        "SELECT * FROM stock_movements WHERE source_type='sale' AND source_id=? AND direction='out'", [rc.order_id]);
      for (const mv of moves) {
        await conn.query(
          `INSERT INTO stock_movements
             (branch_id, warehouse_id, product_id, direction, quantity, source_type, source_id, created_by)
           VALUES (?,?,?, 'in', ?, 'sale', ?, ?)`,
          [mv.branch_id, mv.warehouse_id, mv.product_id, mv.quantity, rc.order_id, uid]);
        await conn.query(
          `INSERT INTO stock_balances (warehouse_id, product_id, quantity, last_movement_at)
           VALUES (?,?,?, NOW())
           ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), last_movement_at = NOW()`,
          [mv.warehouse_id, mv.product_id, mv.quantity]);
      }
      await conn.query("UPDATE orders SET status='canceled' WHERE id=?", [rc.order_id]);
    }

    // پرداختِ هم‌زمان (فروش فروشگاهی): ابطال تراکنش PAYMENT_IN
    if (rc.payment_id) {
      await voidTransactionsBySource(conn, { sourceType: 'payment', sourceId: rc.payment_id, userId: uid, reason });
    }

    await conn.query('UPDATE receipts SET voided_at = NOW(), voided_by = ? WHERE id = ?', [uid, id]);
    await conn.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, old_json, user_id, reason)
       VALUES ('receipts', ?, 'void', ?, ?, ?)`,
      [id, JSON.stringify(rc), uid, reason]);
    await recomputeBalance(conn, rc.person_id);
  });
  res.json({ ok: true });
}));

// ثبت اینکه فاکتور پرینت شد
router.post('/:id/printed', wrap(async (req, res) => {
  await pool.query('UPDATE receipts SET printed_at = NOW() WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
