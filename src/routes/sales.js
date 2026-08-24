import { Router } from 'express';
import { withTx } from '../db.js';
import { auth } from '../mw/auth.js';
import { jalaliYearMonth, orderNo } from '../util.js';
import { postTransaction } from '../services/ledger.js';

export const router = Router();
router.use(auth);

// ثبت فروش/خرید کالا (خوراک دام به دامدار یا محصول به مشتری)
// items: [{ product_id, quantity, unit_price }]
// می‌سازد order + order_items + transaction(debit) → شخص بدهکار می‌شود
router.post('/', async (req, res) => {
  const { person_id, channel = 'store', items = [], note } = req.body || {};
  if (!person_id || !items.length)
    return res.status(400).json({ error: 'شخص و حداقل یک قلم کالا لازم است' });

  const ym = jalaliYearMonth();

  const result = await withTx(async (conn) => {
    let total = 0;
    for (const it of items) {
      const qty = Number(it.quantity), price = Number(it.unit_price);
      if (!(qty > 0) || !(price >= 0)) throw new Error('مقدار یا قیمت نامعتبر');
      total += Math.round(qty * price);
    }

    const [o] = await conn.execute(
      `INSERT INTO orders (order_no, person_id, channel, status, total_amount, note, created_by)
       VALUES (:no,:pid,:ch,'delivered',:total,:note,:by)`,
      { no: orderNo(), pid: person_id, ch: channel, total, note: note || null, by: req.user.id }
    );

    for (const it of items) {
      const amount = Math.round(Number(it.quantity) * Number(it.unit_price));
      await conn.execute(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, amount)
         VALUES (:oid,:pid,:qty,:price,:amount)`,
        { oid: o.insertId, pid: it.product_id, qty: it.quantity, price: it.unit_price, amount }
      );
    }

    const txType = channel === 'farmer' ? 'FEED_SALE' : 'PRODUCT_SALE';
    await postTransaction(conn, {
      person_id, tx_type: txType, direction: 'debit', amount: total,
      year_month: ym, source_type: 'order', source_id: o.insertId,
      description: `فروش کالا (${items.length} قلم)`, created_by: req.user.id,
    });

    return { order_id: o.insertId, total };
  });

  res.status(201).json(result);
});
