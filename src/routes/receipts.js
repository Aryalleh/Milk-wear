import { Router } from 'express';
import crypto from 'crypto';
import { pool, withTx } from '../db.js';
import { postTransaction, resolveMilkPrice, recomputeBalance } from '../ledger.js';
import { notifyReceipt } from '../bale.js';
import { AppError, wrap, currentJalaliMonth, toJalaliDate } from '../util.js';

const router = Router();

// ثبت فاکتور ترکیبی: تحویل شیر + خرید کالا در یک سند
// body: { person_id, branch_id, warehouse_id,
//         milk: { shift, weight_kg, price_per_kg? },
//         items: [{ product_id, quantity, unit_price? }], note }
router.post('/', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'فقط کارمندان می‌توانند فاکتور ثبت کنند');
  const { person_id, branch_id, warehouse_id, milk, items = [], note,
          channel = 'farmer', paid = false, payment_method = 'cash' } = req.body;
  if (!person_id) throw new AppError(400, 'شخص لازم است');
  const hasMilk = milk && milk.shift && Number(milk.weight_kg) > 0;
  const hasItems = Array.isArray(items) && items.length > 0;
  if (!hasMilk && !hasItems) throw new AppError(400, 'حداقل تحویل شیر یا یک قلم خرید لازم است');

  const month = currentJalaliMonth();
  const uid = req.user?.uid || null;

  const receipt = await withTx(async (conn) => {
    let milkAmount = 0, milkDeliveryId = null, milkPrice = null;
    let purchaseAmount = 0, orderId = null;

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
      const orderNo = `SO${Date.now().toString().slice(-9)}`;
      const [o] = await conn.query(
        `INSERT INTO orders (branch_id, order_no, person_id, channel, status, warehouse_id, total_amount, note, created_by)
         VALUES (?,?,?, ?, 'delivered', ?,?,?,?)`,
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
         (branch_id, receipt_no, public_token, person_id, year_month_jalali, milk_delivery_id, order_id,
          milk_amount, purchase_amount, net_amount, balance_after, note, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [branch_id || null, receiptNo, token, person_id, month, milkDeliveryId, orderId,
       milkAmount, purchaseAmount, netAmount, balanceAfter, note || null, uid]
    );
    return { id: rc.insertId, receipt_no: receiptNo, public_token: token,
             milk_amount: milkAmount, purchase_amount: purchaseAmount,
             net_amount: netAmount, balance_after: balanceAfter };
  });

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
  return { receipt: { ...rc, issued_at_jalali: toJalaliDate(rc.issued_at) }, person, branch, milk, items };
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
            r.net_amount, r.balance_after, p.fullname
       FROM receipts r JOIN persons p ON p.id = r.person_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY r.id DESC LIMIT 100`, params);
  res.json(rows);
}));

// ثبت اینکه فاکتور پرینت شد
router.post('/:id/printed', wrap(async (req, res) => {
  await pool.query('UPDATE receipts SET printed_at = NOW() WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
