import { Router } from 'express';
import crypto from 'crypto';
import { pool, withTx } from '../db.js';
import { postTransaction, nextOrderNo, recomputeBalance } from '../ledger.js';
import { enqueueReceipt } from '../print.js';
import { canCreateDelivery } from '../access.js';
import { consumePackaging, restorePackagingForOrder } from '../packaging.js';
import { AppError, wrap, currentJalaliMonth, toJalaliDate } from '../util.js';

const router = Router();

// فهرست سفارش‌ها (کارمند) — با فیلتر وضعیت/کانال + ماندهٔ حساب طرف
router.get('/', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'دسترسی مجاز نیست');
  const { status, channel, fulfillment } = req.query;
  const where = ['o.deleted_at IS NULL'], params = [];
  if (status) { where.push('o.status = ?'); params.push(status); }
  if (channel) { where.push('o.channel = ?'); params.push(channel); }
  if (fulfillment) { where.push('o.fulfillment_type = ?'); params.push(fulfillment); }
  const [rows] = await pool.query(
    `SELECT o.id, o.order_no, o.waybill_no, o.channel, o.fulfillment_type, o.status,
            o.total_amount, o.paid_amount, o.ordered_at, o.destination,
            p.fullname, p.mobile,
            COALESCE(ab.current_balance,0) AS balance,
            (SELECT rc.id FROM receipts rc WHERE rc.order_id = o.id LIMIT 1) AS receipt_id
       FROM orders o JOIN persons p ON p.id = o.person_id
       LEFT JOIN account_balances ab ON ab.person_id = o.person_id
      WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 300`, params);
  res.json(rows);
}));

// مانیفست بارگیری: تجمیع اقلامِ سفارش‌های تحویلیِ در انتظار (چه چیزی و چقدر باید بار زد)
router.get('/manifest', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'دسترسی مجاز نیست');
  // سفارش‌های ارسالیِ آماده (نه تحویل‌شده/لغو)
  const [orders] = await pool.query(
    `SELECT id, order_no FROM orders
      WHERE deleted_at IS NULL AND fulfillment_type='delivery'
        AND status IN ('queued','confirmed') ORDER BY id`);
  const ids = orders.map((o) => o.id);
  let items = [];
  if (ids.length) {
    const [rows] = await pool.query(
      `SELECT p.id AS product_id, p.name AS product_name, u.symbol AS unit,
              SUM(oi.quantity) AS qty, SUM(oi.amount) AS amount
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         LEFT JOIN units u ON u.id = p.unit_id
        WHERE oi.order_id IN (${ids.map(() => '?').join(',')})
        GROUP BY p.id ORDER BY qty DESC`, ids);
    items = rows.map((r) => ({ product_name: r.product_name, unit: r.unit || '', qty: Number(r.qty), amount: Number(r.amount) }));
  }
  const total = items.reduce((s, i) => s + i.amount, 0);
  res.json({ order_count: ids.length, order_ids: ids, items, total });
}));

// تغییر وضعیت سادهٔ سفارش
router.patch('/:id/status', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'دسترسی مجاز نیست');
  const { status } = req.body;
  if (!['queued', 'confirmed', 'delivered', 'settled', 'canceled'].includes(status)) throw new AppError(400, 'وضعیت نامعتبر');
  const [r] = await pool.query('UPDATE orders SET status = ? WHERE id = ? AND deleted_at IS NULL', [status, req.params.id]);
  if (!r.affectedRows) throw new AppError(404, 'سفارش یافت نشد');
  res.json({ ok: true });
}));

// تحویل سفارش + ثبت مبلغِ پرداخت‌شده (کارت/نقد) — ممکن است کمتر/بیشتر/صفر باشد
router.post('/:id/deliver', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'دسترسی مجاز نیست');
  const paid = Math.max(0, Math.round(Number(req.body?.paid_amount || 0)));
  const method = req.body?.payment_method || 'card';
  const result = await withTx(async (conn) => {
    const [[o]] = await conn.query('SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
    if (!o) throw new AppError(404, 'سفارش یافت نشد');
    if (paid > 0) {
      const [pay] = await conn.query(
        `INSERT INTO payments (branch_id, person_id, direction, method, amount, note, created_by)
         VALUES (?,?, 'in', ?, ?, 'دریافت هنگام تحویل', ?)`,
        [o.branch_id, o.person_id, method, paid, req.user?.uid || null]);
      await postTransaction(conn, {
        personId: o.person_id, txType: 'PAYMENT_IN', amount: paid,
        sourceType: 'payment', sourceId: pay.insertId, description: `دریافت هنگام تحویل سفارش ${o.order_no}`,
        branchId: o.branch_id, userId: req.user?.uid, month: currentJalaliMonth(),
      });
    }
    await conn.query('UPDATE orders SET status=\'delivered\', paid_amount = paid_amount + ? WHERE id = ?', [paid, o.id]);
    const balance = await recomputeBalance(conn, o.person_id);
    return { ok: true, paid, balance };
  });
  res.json(result);
}));

// دریافت یک سفارش (برای بارنامه/فاکتور) + ماندهٔ حساب طرف
router.get('/:id', wrap(async (req, res) => {
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
  if (!order) throw new AppError(404, 'سفارش یافت نشد');
  if (req.user.kind !== 'staff' && order.person_id !== req.user.person_id)
    throw new AppError(403, 'دسترسی مجاز نیست');

  const [[person]] = await pool.query(
    'SELECT id, person_code, fullname, mobile, address FROM persons WHERE id = ?', [order.person_id]);
  const [[branch]] = await pool.query(
    'SELECT id, name, phone, address FROM branches WHERE id = ?', [order.branch_id]);
  const [items] = await pool.query(
    `SELECT oi.*, p.name AS product_name, u.symbol AS unit
       FROM order_items oi JOIN products p ON p.id = oi.product_id
       LEFT JOIN units u ON u.id = p.unit_id WHERE oi.order_id = ?`, [order.id]);
  const [[receipt]] = await pool.query(
    'SELECT id, receipt_no, public_token FROM receipts WHERE order_id = ? ORDER BY id DESC LIMIT 1', [order.id]);
  const [[bal]] = await pool.query('SELECT current_balance FROM account_balances WHERE person_id = ?', [order.person_id]);
  order.ordered_at_jalali = toJalaliDate(order.ordered_at || order.created_at);
  res.json({ order, person, branch, items, receipt: receipt || null, balance: Number(bal?.current_balance || 0) });
}));

// ثبت سفارش/فروش توسط کارمند (فروشگاه و سفارش یکی شده‌اند)
//  fulfillment_type: pickup (درجا می‌گیرد → تحویل‌شده) | delivery (راننده می‌برد → در صف)
//  paid_amount: مبلغ پرداخت‌شده هنگام ثبت (نقد/کارت) — می‌تواند کمتر/بیشتر/صفر باشد
router.post('/', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'فقط کارمندان می‌توانند فروش ثبت کنند');
  const { person_id, items, warehouse_id, note, branch_id,
          fulfillment_type = 'delivery', destination = null,
          paid_amount = 0, payment_method = 'cash', print = false } = req.body;
  if (!person_id || !Array.isArray(items) || items.length === 0)
    throw new AppError(400, 'شخص و حداقل یک قلم کالا لازم است');
  const fulfill = fulfillment_type === 'pickup' ? 'pickup' : 'delivery';
  if (fulfill === 'delivery' && !canCreateDelivery(req.user.role))
    throw new AppError(403, 'این نقش اجازهٔ ثبت سفارشِ ارسالی ندارد؛ فقط فروش حضوری.');
  const paid = Math.max(0, Math.round(Number(paid_amount || 0)));
  const allowNegative = req.body.allow_negative === true;   // بای‌پس خطای کسری موجودی
  const noPackaging = req.body.no_packaging === true;       // مشتری ظرف خودش را آورده
  const paidFull = req.body.paid_full === true;             // «پرداخت کامل» = دقیقاً برابر جمع نهایی (با ظرف)

  const result = await withTx(async (conn) => {
    let total = 0;
    const lines = [];
    const shortages = [];
    for (const it of items) {
      const [[prod]] = await conn.query('SELECT * FROM products WHERE id = ?', [it.product_id]);
      if (!prod) throw new AppError(400, `کالا یافت نشد: ${it.product_id}`);
      const price = it.unit_price != null ? Number(it.unit_price) : Number(prod.base_price);
      const qty = Number(it.quantity);
      const amount = Math.round(price * qty);
      total += amount;
      lines.push({ prod, quantity: qty, price, amount });
      // بررسی موجودی برای کالاهای انبارداری‌شده
      if (prod.track_stock && warehouse_id) {
        const [[bal]] = await conn.query(
          'SELECT COALESCE(quantity,0) q FROM stock_balances WHERE warehouse_id=? AND product_id=?',
          [warehouse_id, prod.id]);
        const onHand = Number(bal?.q || 0);
        if (onHand < qty) shortages.push({ product: prod.name, on_hand: onHand, need: qty });
      }
    }
    // اگر کسری موجودی هست و بای‌پس نشده → خطای قابل‌فهم برمی‌گردانیم
    if (shortages.length && !allowNegative) {
      const msg = 'کسری موجودی: ' + shortages.map((s) => `${s.product} (موجود ${s.on_hand}، نیاز ${s.need})`).join('، ');
      const err = new AppError(409, msg);
      err.shortages = shortages;
      throw err;
    }

    const orderNo = await nextOrderNo(conn);
    // حضوری = همان‌جا تحویل شد؛ ارسالی = در صفِ راننده
    const status = fulfill === 'pickup' ? 'delivered' : 'queued';
    const [o] = await conn.query(
      `INSERT INTO orders (branch_id, order_no, waybill_no, person_id, channel, fulfillment_type, no_packaging, status,
                           warehouse_id, total_amount, paid_amount, note, destination, created_by)
       VALUES (?,?,?,?, 'distribution', ?, ?, ?, ?,?,?,?,?,?)`,
      [branch_id || null, orderNo, orderNo, person_id, fulfill, noPackaging ? 1 : 0, status,
       warehouse_id || null, total, paid, note || null, destination || null, req.user?.uid || null]);
    const orderId = o.insertId;

    let packagingTotal = 0;
    for (const ln of lines) {
      const [oi] = await conn.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, amount) VALUES (?,?,?,?,?)`,
        [orderId, ln.prod.id, ln.quantity, ln.price, ln.amount]);
      // هزینهٔ ظرف (FIFO + درصد سود) اگر کالا بسته‌بندی دارد و مشتری ظرف نیاورده
      if (ln.prod.packaging_id && !noPackaging) {
        const cap = Number(ln.prod.packaging_capacity) > 0 ? Number(ln.prod.packaging_capacity) : 1;
        const need = Math.ceil(ln.quantity / cap);   // تعداد ظرفِ لازم = مقدار ÷ ظرفیت (روبه‌بالا)
        const [[pkg]] = await conn.query('SELECT default_price, margin_pct FROM packagings WHERE id=?', [ln.prod.packaging_id]);
        const { cost } = await consumePackaging(conn, ln.prod.packaging_id, need, orderId, oi.insertId, pkg?.default_price || 0);
        const charged = Math.round(cost * (1 + (Number(pkg?.margin_pct) || 0) / 100));   // هزینهٔ خرید + سود
        if (charged > 0) {
          await conn.query('UPDATE order_items SET packaging_qty=?, packaging_cost=? WHERE id=?', [need, charged, oi.insertId]);
          packagingTotal += charged;
        }
      }
      if (ln.prod.track_stock && warehouse_id) {
        await conn.query(
          `INSERT INTO stock_movements
             (branch_id, warehouse_id, product_id, direction, quantity, source_type, source_id, created_by)
           VALUES (?,?,?, 'out', ?, 'sale', ?, ?)`,
          [branch_id || null, warehouse_id, ln.prod.id, ln.quantity, orderId, req.user?.uid || null]);
        await conn.query(
          `INSERT INTO stock_balances (warehouse_id, product_id, quantity, last_movement_at)
           VALUES (?,?,?, NOW())
           ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), last_movement_at = NOW()`,
          [warehouse_id, ln.prod.id, -ln.quantity]);
      }
    }
    // جمع کل شامل هزینهٔ ظرف
    const grandTotal = total + packagingTotal;
    // «پرداخت کامل» دقیقاً برابرِ جمعِ نهایی (با ظرف) → مشتری بدهکارِ ظرف نمی‌شود
    const finalPaid = paidFull ? grandTotal : paid;
    if (packagingTotal > 0 || finalPaid !== paid)
      await conn.query('UPDATE orders SET total_amount=?, paid_amount=? WHERE id=?', [grandTotal, finalPaid, orderId]);

    const hasFeed = lines.some((l) => l.prod.category_id === 2);
    await postTransaction(conn, {
      personId: person_id, txType: hasFeed ? 'FEED_SALE' : 'PRODUCT_SALE', amount: grandTotal,
      sourceType: 'order', sourceId: orderId,
      description: lines.map((l) => `${l.prod.name}×${l.quantity}`).join('، ') + (packagingTotal ? ` + ظرف` : ''),
      branchId: branch_id || null, userId: req.user?.uid, month: currentJalaliMonth(),
    });

    // پرداخت هنگام ثبت (نقد/کارت) — دریافت از مشتری
    if (finalPaid > 0) {
      const [pay] = await conn.query(
        `INSERT INTO payments (branch_id, person_id, direction, method, amount, note, created_by)
         VALUES (?,?, 'in', ?, ?, 'دریافت هنگام فروش', ?)`,
        [branch_id || null, person_id, payment_method, finalPaid, req.user?.uid || null]);
      await postTransaction(conn, {
        personId: person_id, txType: 'PAYMENT_IN', amount: finalPaid,
        sourceType: 'payment', sourceId: pay.insertId, description: 'دریافت هنگام فروش',
        branchId: branch_id || null, userId: req.user?.uid, month: currentJalaliMonth(),
      });
    }

    const balanceAfter = await recomputeBalance(conn, person_id);
    const receiptNo = `RC${Date.now().toString().slice(-10)}`;
    const token = crypto.randomBytes(16).toString('hex');
    const [rc] = await conn.query(
      `INSERT INTO receipts (branch_id, receipt_no, public_token, person_id, year_month_jalali, order_id,
                             milk_amount, purchase_amount, net_amount, balance_after, note, created_by)
       VALUES (?,?,?,?,?,?, 0, ?, ?, ?, ?, ?)`,
      [branch_id || null, receiptNo, token, person_id, currentJalaliMonth(), orderId,
       grandTotal, -grandTotal, balanceAfter, note || null, req.user?.uid || null]);

    return { id: orderId, order_no: orderNo, total_amount: grandTotal, paid_amount: finalPaid,
             fulfillment_type: fulfill, status, receipt_id: rc.insertId, packaging_cost: packagingTotal };
  });

  // چاپ رسید دلبخواهی (فروش حضوری معمولاً چاپ می‌خواهد)
  if (print) enqueueReceipt(result.receipt_id).catch((e) => console.error('enqueueReceipt:', e.message));
  res.status(201).json(result);
}));

// ویرایش سفارشِ تحویل‌نشده: برگردانِ موجودی/ظرف/تراکنشِ قبلی + اعمالِ اقلام جدید
router.put('/:id/edit', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'دسترسی مجاز نیست');
  const { items, destination, note } = req.body;
  if (!Array.isArray(items) || items.length === 0) throw new AppError(400, 'حداقل یک قلم کالا لازم است');
  const allowNegative = req.body.allow_negative === true;

  const out = await withTx(async (conn) => {
    const [[order]] = await conn.query('SELECT * FROM orders WHERE id=? AND deleted_at IS NULL', [req.params.id]);
    if (!order) throw new AppError(404, 'سفارش یافت نشد');
    if (!['queued', 'confirmed'].includes(order.status))
      throw new AppError(400, 'فقط سفارش‌های تحویل‌نشده قابل ویرایش‌اند');
    const warehouseId = order.warehouse_id, branchId = order.branch_id;
    const noPack = req.body.no_packaging !== undefined ? req.body.no_packaging === true : !!order.no_packaging;
    if (req.body.no_packaging !== undefined) await conn.query('UPDATE orders SET no_packaging=? WHERE id=?', [noPack ? 1 : 0, order.id]);

    // ۱) برگردانِ موجودیِ اقلام قبلی
    const [oldItems] = await conn.query(
      'SELECT oi.quantity, oi.product_id, p.track_stock FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?', [order.id]);
    for (const it of oldItems) {
      if (it.track_stock && warehouseId)
        await conn.query('UPDATE stock_balances SET quantity=quantity+? WHERE warehouse_id=? AND product_id=?', [it.quantity, warehouseId, it.product_id]);
    }
    // ۲) برگردانِ ظرف‌های مصرف‌شده به لایه‌ها
    await restorePackagingForOrder(conn, order.id);
    // ۳) باطل‌کردن تراکنشِ فروشِ قبلی
    await conn.query("UPDATE transactions SET status='voided' WHERE source_type='order' AND source_id=? AND tx_type IN ('PRODUCT_SALE','FEED_SALE') AND status='active'", [order.id]);
    // ۴) حذف اقلام و حرکت‌های انبارِ قبلی
    await conn.query("DELETE FROM stock_movements WHERE source_type='sale' AND source_id=?", [order.id]);
    await conn.query('DELETE FROM order_items WHERE order_id=?', [order.id]);

    // ۵) اقلام جدید + بررسی موجودی
    let total = 0; const lines = []; const shortages = [];
    for (const it of items) {
      const [[prod]] = await conn.query('SELECT * FROM products WHERE id=?', [it.product_id]);
      if (!prod) throw new AppError(400, `کالا یافت نشد: ${it.product_id}`);
      const price = it.unit_price != null ? Number(it.unit_price) : Number(prod.base_price);
      const qty = Number(it.quantity); const amount = Math.round(price * qty);
      total += amount; lines.push({ prod, qty, price, amount });
      if (prod.track_stock && warehouseId) {
        const [[bal]] = await conn.query('SELECT quantity q FROM stock_balances WHERE warehouse_id=? AND product_id=?', [warehouseId, prod.id]);
        if (Number(bal?.q || 0) < qty) shortages.push({ product: prod.name, on_hand: Number(bal?.q || 0), need: qty });
      }
    }
    if (shortages.length && !allowNegative)
      throw new AppError(409, 'کسری موجودی: ' + shortages.map((s) => `${s.product} (موجود ${s.on_hand}، نیاز ${s.need})`).join('، '));

    // ۶) اعمال اقلام + ظرف
    let packagingTotal = 0;
    for (const ln of lines) {
      const [oi] = await conn.query('INSERT INTO order_items (order_id,product_id,quantity,unit_price,amount) VALUES (?,?,?,?,?)',
        [order.id, ln.prod.id, ln.qty, ln.price, ln.amount]);
      if (ln.prod.packaging_id && !noPack) {
        const cap = Number(ln.prod.packaging_capacity) > 0 ? Number(ln.prod.packaging_capacity) : 1;
        const need = Math.ceil(ln.qty / cap);
        const [[pkg]] = await conn.query('SELECT default_price, margin_pct FROM packagings WHERE id=?', [ln.prod.packaging_id]);
        const { cost } = await consumePackaging(conn, ln.prod.packaging_id, need, order.id, oi.insertId, pkg?.default_price || 0);
        const charged = Math.round(cost * (1 + (Number(pkg?.margin_pct) || 0) / 100));
        if (charged > 0) { await conn.query('UPDATE order_items SET packaging_qty=?, packaging_cost=? WHERE id=?', [need, charged, oi.insertId]); packagingTotal += charged; }
      }
      if (ln.prod.track_stock && warehouseId) {
        await conn.query("INSERT INTO stock_movements (branch_id,warehouse_id,product_id,direction,quantity,source_type,source_id,created_by) VALUES (?,?,?, 'out', ?, 'sale', ?, ?)",
          [branchId, warehouseId, ln.prod.id, ln.qty, order.id, req.user?.uid || null]);
        await conn.query('UPDATE stock_balances SET quantity=quantity-? WHERE warehouse_id=? AND product_id=?', [ln.qty, warehouseId, ln.prod.id]);
      }
    }
    const grandTotal = total + packagingTotal;
    await conn.query('UPDATE orders SET total_amount=?, destination=COALESCE(?,destination), note=COALESCE(?,note) WHERE id=?',
      [grandTotal, destination ?? null, note ?? null, order.id]);

    const hasFeed = lines.some((l) => l.prod.category_id === 2);
    await postTransaction(conn, {
      personId: order.person_id, txType: hasFeed ? 'FEED_SALE' : 'PRODUCT_SALE', amount: grandTotal,
      sourceType: 'order', sourceId: order.id,
      description: 'ویرایش: ' + lines.map((l) => `${l.prod.name}×${l.qty}`).join('، ') + (packagingTotal ? ' + ظرف' : ''),
      branchId, userId: req.user?.uid, month: currentJalaliMonth(),
    });
    const balanceAfter = await recomputeBalance(conn, order.person_id);
    await conn.query('UPDATE receipts SET purchase_amount=?, net_amount=?, balance_after=? WHERE order_id=?',
      [grandTotal, -grandTotal, balanceAfter, order.id]);
    return { ok: true, total_amount: grandTotal, packaging_cost: packagingTotal };
  });
  res.json(out);
}));

export default router;
