// پنل شخصی دامدار/مشتری — هر کس فقط دادهٔ خودش
import { Router } from 'express';
import { pool, withTx } from '../db.js';
import { personRequired } from '../auth.js';
import { postTransaction, recomputeBalance, nextOrderNo } from '../ledger.js';
import { AppError, wrap, currentJalaliMonth, toJalaliDate } from '../util.js';

const router = Router();
router.use(personRequired);

// داشبورد خلاصهٔ حساب من
router.get('/dashboard', wrap(async (req, res) => {
  const pid = req.user.person_id;
  const [[p]] = await pool.query(
    'SELECT id, person_code, fullname, mobile FROM persons WHERE id = ?', [pid]);
  const [[b]] = await pool.query('SELECT * FROM account_balances WHERE person_id = ?', [pid]);
  const bal = b || {};
  const cb = Number(bal.current_balance || 0);
  res.json({
    person: { id: p.id, code: p.person_code, fullname: p.fullname, mobile: p.mobile },
    role: req.user.role,
    balance: {
      current_balance: cb,
      payable_now: cb > 0 ? cb : 0,          // شرکت به من بدهکار (دامدار)
      payable_by_me: cb < 0 ? -cb : 0,       // من به شرکت بدهکار (مشتری)
      milk_kg_month: Number(bal.milk_kg_month || 0),
      milk_value_month: Number(bal.milk_value_month || 0),
      purchases_total: Number(bal.purchases_total || 0),
      payments_total: Number(bal.payments_total || 0),
      status: bal.status || 'settled',
    },
  });
}));

// گردش حساب من (دفتر)
router.get('/ledger', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT t.id, t.tx_date, t.tx_type, t.description, t.direction, t.amount,
            SUM(CASE WHEN t.direction='credit' THEN t.amount ELSE -t.amount END)
              OVER (ORDER BY t.tx_date, t.id) AS running_balance
       FROM transactions t
      WHERE t.person_id = ? AND t.status='active'
      ORDER BY t.tx_date, t.id`, [req.user.person_id]);
  res.json(rows.map((r) => ({
    date_jalali: toJalaliDate(r.tx_date),
    type: r.tx_type, description: r.description,
    debit: r.direction === 'debit' ? Number(r.amount) : 0,
    credit: r.direction === 'credit' ? Number(r.amount) : 0,
    balance: Number(r.running_balance),
  })));
}));

// فاکتورهای من
router.get('/receipts', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, receipt_no, issued_at, milk_amount, purchase_amount, net_amount, balance_after
       FROM receipts WHERE person_id = ? ORDER BY id DESC LIMIT 100`, [req.user.person_id]);
  res.json(rows);
}));

// شیرهای تحویلی من (دامدار) — هر دفعه با وزن/چربی/مبلغ
router.get('/milk', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, shift, delivered_at, weight_kg, fat_pct, price_per_kg, amount
       FROM milk_deliveries WHERE person_id = ? AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 100`, [req.user.person_id]);
  res.json(rows.map((r) => ({
    id: r.id, shift: r.shift, date_jalali: toJalaliDate(r.delivered_at),
    weight_kg: Number(r.weight_kg), fat_pct: r.fat_pct != null ? Number(r.fat_pct) : null,
    price_per_kg: Number(r.price_per_kg), amount: Number(r.amount),
  })));
}));

// ثبت فاکتور فروش توسط شخص (شرکت از او خرید می‌کند) با عکس → در انتظار تأیید مدیر
router.post('/invoices', wrap(async (req, res) => {
  const { amount, description, photo } = req.body;   // amount به ریال
  if (!amount || Number(amount) <= 0) throw new AppError(400, 'مبلغ لازم است');
  if (photo && photo.length > 8000000) throw new AppError(400, 'حجم عکس زیاد است (حداکثر ~۶ مگابایت)');
  const amt = Math.round(Number(amount));
  const pid = req.user.person_id;
  const [[p]] = await pool.query('SELECT trusted FROM persons WHERE id = ?', [pid]);

  if (p && p.trusted) {
    // شخص معتمد → مستقیم ثبت و به حساب اضافه می‌شود
    const out = await withTx(async (conn) => {
      const [s] = await conn.query(
        "INSERT INTO purchase_submissions (person_id, amount, description, photo, status, approved_at) VALUES (?,?,?,?, 'approved', NOW())",
        [pid, amt, description || null, photo || null]);
      const txId = await postTransaction(conn, {
        personId: pid, txType: 'PURCHASE', amount: amt, sourceType: 'manual', sourceId: s.insertId,
        description: 'خرید از شخص (معتمد)' + (description ? (' — ' + description) : ''), month: currentJalaliMonth(),
      });
      await conn.query('UPDATE purchase_submissions SET tx_id = ? WHERE id = ?', [txId, s.insertId]);
      return { id: s.insertId, auto: true };
    });
    return res.status(201).json(out);
  }

  const [r] = await pool.query(
    'INSERT INTO purchase_submissions (person_id, amount, description, photo) VALUES (?,?,?,?)',
    [pid, amt, description || null, photo || null]);
  res.status(201).json({ id: r.insertId, auto: false });
}));

// فاکتورهای ارسالی من و وضعیتشان
router.get('/invoices', wrap(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, amount, description, status, created_at FROM purchase_submissions WHERE person_id=? ORDER BY id DESC LIMIT 50',
    [req.user.person_id]);
  res.json(rows.map((r) => ({ id: r.id, amount: Number(r.amount), description: r.description, status: r.status, created_jalali: toJalaliDate(r.created_at) })));
}));

// سفارش‌های من
router.get('/orders', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT o.id, o.order_no, o.waybill_no, o.status, o.total_amount, o.ordered_at, o.destination,
            (SELECT rc.id FROM receipts rc WHERE rc.order_id = o.id LIMIT 1) AS receipt_id
       FROM orders o WHERE o.person_id = ? AND o.deleted_at IS NULL
      ORDER BY o.id DESC LIMIT 100`,
    [req.user.person_id]);
  res.json(rows);
}));

// ثبت سفارش توسط مشتری → سفارش + فاکتور + بارنامه (آمادهٔ چاپ)
router.post('/orders', wrap(async (req, res) => {
  const { items, destination, note } = req.body;
  if (!Array.isArray(items) || items.length === 0)
    throw new AppError(400, 'حداقل یک قلم کالا لازم است');
  const pid = req.user.person_id;
  const month = currentJalaliMonth();

  const out = await withTx(async (conn) => {
    // انبار پیش‌فرض برای خروج کالا (فروشگاه یا مرکز پخش)
    const [[wh]] = await conn.query(
      `SELECT id, branch_id FROM warehouses WHERE type IN ('store','distribution') AND is_active=1 LIMIT 1`);
    const warehouseId = wh?.id || null;
    const branchId = wh?.branch_id || null;

    let total = 0; const lines = [];
    for (const it of items) {
      const [[prod]] = await conn.query('SELECT * FROM products WHERE id = ? AND is_active=1', [it.product_id]);
      if (!prod) throw new AppError(400, `کالا یافت نشد: ${it.product_id}`);
      const amount = Math.round(Number(prod.base_price) * Number(it.quantity));
      total += amount;
      lines.push({ prod, quantity: Number(it.quantity), price: Number(prod.base_price), amount });
    }

    const orderNo = await nextOrderNo(conn);
    const waybillNo = orderNo;
    const [o] = await conn.query(
      `INSERT INTO orders (branch_id, order_no, waybill_no, person_id, channel, status,
                           warehouse_id, total_amount, note, destination, created_by)
       VALUES (?,?,?,?, 'distribution', 'confirmed', ?,?,?,?, NULL)`,
      [branchId, orderNo, waybillNo, pid, warehouseId, total, note || null, destination || null]);
    const orderId = o.insertId;

    for (const ln of lines) {
      await conn.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, amount) VALUES (?,?,?,?,?)`,
        [orderId, ln.prod.id, ln.quantity, ln.price, ln.amount]);
      if (ln.prod.track_stock && warehouseId) {
        await conn.query(
          `INSERT INTO stock_movements (branch_id, warehouse_id, product_id, direction, quantity, source_type, source_id)
           VALUES (?,?,?, 'out', ?, 'sale', ?)`,
          [branchId, warehouseId, ln.prod.id, ln.quantity, orderId]);
        await conn.query(
          `INSERT INTO stock_balances (warehouse_id, product_id, quantity, last_movement_at)
           VALUES (?,?,?, NOW())
           ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), last_movement_at = NOW()`,
          [warehouseId, ln.prod.id, -ln.quantity]);
      }
    }

    await postTransaction(conn, {
      personId: pid, txType: 'PRODUCT_SALE', amount: total,
      sourceType: 'order', sourceId: orderId,
      description: lines.map((l) => `${l.prod.name}×${l.quantity}`).join('، '),
      branchId, month,
    });

    const balanceAfter = await recomputeBalance(conn, pid);
    const receiptNo = `RC${Date.now().toString().slice(-10)}`;
    const [rc] = await conn.query(
      `INSERT INTO receipts (branch_id, receipt_no, person_id, year_month_jalali, order_id,
                             milk_amount, purchase_amount, net_amount, balance_after, note)
       VALUES (?,?,?,?,?, 0, ?, ?, ?, ?)`,
      [branchId, receiptNo, pid, month, orderId, total, -total, balanceAfter, note || null]);

    return { order_id: orderId, order_no: orderNo, waybill_no: waybillNo,
             receipt_id: rc.insertId, total };
  });
  res.status(201).json(out);
}));

export default router;
