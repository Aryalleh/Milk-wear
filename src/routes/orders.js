import { Router } from 'express';
import { pool, withTx } from '../db.js';
import { postTransaction, nextOrderNo } from '../ledger.js';
import { AppError, wrap, currentJalaliMonth, toJalaliDate } from '../util.js';

const router = Router();

// فهرست سفارش‌ها (کارمند) — با فیلتر وضعیت/کانال
router.get('/', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'دسترسی مجاز نیست');
  const { status, channel } = req.query;
  const where = ['o.deleted_at IS NULL'], params = [];
  if (status) { where.push('o.status = ?'); params.push(status); }
  if (channel) { where.push('o.channel = ?'); params.push(channel); }
  const [rows] = await pool.query(
    `SELECT o.id, o.order_no, o.waybill_no, o.channel, o.status, o.total_amount, o.ordered_at, o.destination,
            p.fullname, p.mobile,
            (SELECT rc.id FROM receipts rc WHERE rc.order_id = o.id LIMIT 1) AS receipt_id
       FROM orders o JOIN persons p ON p.id = o.person_id
      WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 300`, params);
  res.json(rows);
}));

// تغییر وضعیت سفارش (تحویل/بستن) — کارمند
router.patch('/:id/status', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'دسترسی مجاز نیست');
  const { status } = req.body;
  if (!['confirmed', 'delivered', 'settled', 'canceled'].includes(status)) throw new AppError(400, 'وضعیت نامعتبر');
  const [r] = await pool.query('UPDATE orders SET status = ? WHERE id = ? AND deleted_at IS NULL', [status, req.params.id]);
  if (!r.affectedRows) throw new AppError(404, 'سفارش یافت نشد');
  res.json({ ok: true });
}));

// دریافت یک سفارش (برای بارنامه/فاکتور) — کارمند یا صاحب سفارش
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
  // فاکتور مرتبط با این سفارش (برای QRِ بارنامه که به فاکتور اشاره می‌کند)
  const [[receipt]] = await pool.query(
    'SELECT id, receipt_no, public_token FROM receipts WHERE order_id = ? ORDER BY id DESC LIMIT 1', [order.id]);
  order.ordered_at_jalali = toJalaliDate(order.ordered_at || order.created_at);
  res.json({ order, person, branch, items, receipt: receipt || null });
}));

// ثبت فروش/سفارش توسط کارمند → تراکنش خرید (بدهکار شخص) + خروج از انبار
router.post('/', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'فقط کارمندان می‌توانند فروش ثبت کنند');
  const { person_id, items, channel = 'store', warehouse_id, note, branch_id } = req.body;
  if (!person_id || !Array.isArray(items) || items.length === 0)
    throw new AppError(400, 'شخص و حداقل یک قلم کالا لازم است');

  const result = await withTx(async (conn) => {
    // قیمت هر قلم از دیتابیس گرفته و قفل می‌شود
    let total = 0;
    const lines = [];
    for (const it of items) {
      const [[prod]] = await conn.query('SELECT * FROM products WHERE id = ?', [it.product_id]);
      if (!prod) throw new AppError(400, `کالا یافت نشد: ${it.product_id}`);
      const price = it.unit_price != null ? Number(it.unit_price) : Number(prod.base_price);
      const amount = Math.round(price * Number(it.quantity));
      total += amount;
      lines.push({ prod, quantity: Number(it.quantity), price, amount });
    }

    const orderNo = await nextOrderNo(conn);
    const [o] = await conn.query(
      `INSERT INTO orders (branch_id, order_no, person_id, channel, status, warehouse_id, total_amount, note, created_by)
       VALUES (?,?,?,?, 'delivered', ?,?,?,?)`,
      [branch_id || null, orderNo, person_id, channel, warehouse_id || null, total, note || null, req.user?.uid || null]
    );
    const orderId = o.insertId;

    for (const ln of lines) {
      await conn.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, amount)
         VALUES (?,?,?,?,?)`,
        [orderId, ln.prod.id, ln.quantity, ln.price, ln.amount]
      );
      // خروج از انبار برای کالاهای انبارداری‌شده
      if (ln.prod.track_stock && warehouse_id) {
        await conn.query(
          `INSERT INTO stock_movements
             (branch_id, warehouse_id, product_id, direction, quantity, source_type, source_id, created_by)
           VALUES (?,?,?, 'out', ?, 'sale', ?, ?)`,
          [branch_id || null, warehouse_id, ln.prod.id, ln.quantity, orderId, req.user?.uid || null]
        );
        await conn.query(
          `INSERT INTO stock_balances (warehouse_id, product_id, quantity, last_movement_at)
           VALUES (?,?,?, NOW())
           ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), last_movement_at = NOW()`,
          [warehouse_id, ln.prod.id, -ln.quantity]
        );
      }
    }

    // آیا سفارش شامل خوراک دام است؟ → نوع تراکنش FEED_SALE
    const hasFeed = lines.some((l) => l.prod.category_id === 2);
    const txType = hasFeed ? 'FEED_SALE' : 'PRODUCT_SALE';
    const desc = lines.map((l) => `${l.prod.name}×${l.quantity}`).join('، ');

    await postTransaction(conn, {
      personId: person_id, txType, amount: total,
      sourceType: 'order', sourceId: orderId, description: desc,
      branchId: branch_id || null, userId: req.user?.uid, month: currentJalaliMonth(),
    });

    return { id: orderId, order_no: orderNo, total_amount: total };
  });
  res.status(201).json(result);
}));

export default router;
