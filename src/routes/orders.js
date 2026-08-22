import { Router } from 'express';
import { pool, withTx } from '../db.js';
import { postTransaction } from '../ledger.js';
import { AppError, wrap, currentJalaliMonth } from '../util.js';

const router = Router();

// ثبت فروش/سفارش → تراکنش خرید (بدهکار شخص) + خروج از انبار
router.post('/', wrap(async (req, res) => {
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

    const orderNo = `SO${Date.now().toString().slice(-9)}`;
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
