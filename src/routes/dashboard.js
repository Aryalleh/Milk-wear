// داشبورد مدیریت — خلاصهٔ زندهٔ همهٔ بخش‌ها
import { Router } from 'express';
import { pool } from '../db.js';
import { staffRequired } from '../auth.js';
import { wrap, toJalaliDate, currentJalaliMonth } from '../util.js';

const router = Router();
router.use(staffRequired);

router.get('/', wrap(async (req, res) => {
  const month = currentJalaliMonth();

  // ایستگاه شیر — دریافت امروز
  const [[station]] = await pool.query(
    `SELECT COALESCE(SUM(weight_kg),0) AS kg, COALESCE(SUM(amount),0) AS value,
            COUNT(DISTINCT person_id) AS farmers
       FROM milk_deliveries WHERE DATE(delivered_at)=CURDATE() AND deleted_at IS NULL`);

  // سالن تولید — امروز
  const [[prodToday]] = await pool.query(
    `SELECT COALESCE(SUM(pi.quantity),0) AS milk_in, COUNT(DISTINCT pb.id) AS batches
       FROM production_batches pb LEFT JOIN production_inputs pi ON pi.batch_id=pb.id
      WHERE DATE(pb.started_at)=CURDATE()`);
  const [prodOutToday] = await pool.query(
    `SELECT pr.name, COALESCE(SUM(po.quantity),0) AS qty, u.symbol AS unit
       FROM production_outputs po JOIN production_batches pb ON pb.id=po.batch_id
       JOIN products pr ON pr.id=po.product_id LEFT JOIN units u ON u.id=pr.unit_id
      WHERE DATE(pb.started_at)=CURDATE() GROUP BY pr.id ORDER BY qty DESC`);

  // فروشگاه — فروش امروز (کانال store)
  const [[store]] = await pool.query(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS value
       FROM orders WHERE channel='store' AND DATE(ordered_at)=CURDATE() AND deleted_at IS NULL`);

  // پخش — سفارش‌های امروز
  const [[dist]] = await pool.query(
    `SELECT COUNT(*) AS orders,
            SUM(status='delivered') AS delivered,
            SUM(status IN ('confirmed','draft')) AS remaining,
            COALESCE(SUM(total_amount),0) AS value
       FROM orders WHERE channel='distribution' AND DATE(ordered_at)=CURDATE() AND deleted_at IS NULL`);

  // حساب‌ها — طلب از مشتریان / بدهی به دامداران (از مانده‌ها)
  const [[acc]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN current_balance>0 THEN current_balance ELSE 0 END),0) AS payable,
            COALESCE(SUM(CASE WHEN current_balance<0 THEN -current_balance ELSE 0 END),0) AS receivable
       FROM account_balances`);

  // علی‌الحساب و دریافتی امروز
  const [[cash]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN tx_type IN ('PAYMENT_OUT','CASH_WITHDRAWAL') THEN amount END),0) AS onaccount,
            COALESCE(SUM(CASE WHEN tx_type='PAYMENT_IN' THEN amount END),0) AS received,
            COALESCE(SUM(CASE WHEN tx_type IN ('PRODUCT_SALE','FEED_SALE') THEN amount END),0) AS goods
       FROM transactions WHERE DATE(tx_date)=CURDATE() AND status='active'`);

  // روند فراوری این ماه: شیر ورودی → محصولات خروجی
  const [[procIn]] = await pool.query(
    `SELECT COALESCE(SUM(pi.quantity),0) AS milk_in
       FROM production_inputs pi JOIN production_batches pb ON pb.id=pi.batch_id
      WHERE pb.started_at >= DATE_FORMAT(NOW(),'%Y-%m-01')`);
  const [procOut] = await pool.query(
    `SELECT pr.name, COALESCE(SUM(po.quantity),0) AS qty, u.symbol AS unit
       FROM production_outputs po JOIN production_batches pb ON pb.id=po.batch_id
       JOIN products pr ON pr.id=po.product_id LEFT JOIN units u ON u.id=pr.unit_id
      WHERE pb.started_at >= DATE_FORMAT(NOW(),'%Y-%m-01') GROUP BY pr.id ORDER BY qty DESC`);

  // شیر امروز به تفکیک دامدار
  const [byFarmer] = await pool.query(
    `SELECT p.fullname, SUM(md.weight_kg) AS kg, SUM(md.amount) AS value
       FROM milk_deliveries md JOIN persons p ON p.id=md.person_id
      WHERE DATE(md.delivered_at)=CURDATE() AND md.deleted_at IS NULL
      GROUP BY p.id ORDER BY kg DESC LIMIT 30`);

  res.json({
    date_jalali: toJalaliDate(new Date()),
    month,
    station: { kg: Number(station.kg), value: Number(station.value), farmers: station.farmers },
    production: {
      milk_in: Number(prodToday.milk_in), batches: prodToday.batches,
      outputs: prodOutToday.map((o) => ({ name: o.name, qty: Number(o.qty), unit: o.unit })),
    },
    store: { count: store.count, value: Number(store.value) },
    distribution: {
      orders: dist.orders, delivered: Number(dist.delivered || 0),
      remaining: Number(dist.remaining || 0), value: Number(dist.value),
    },
    accounts: { payable: Number(acc.payable), receivable: Number(acc.receivable) },
    cash: { onaccount: Number(cash.onaccount), received: Number(cash.received), goods: Number(cash.goods) },
    processing: {
      milk_in: Number(procIn.milk_in),
      outputs: procOut.map((o) => ({ name: o.name, qty: Number(o.qty), unit: o.unit })),
    },
    by_farmer: byFarmer.map((f) => ({ fullname: f.fullname, kg: Number(f.kg), value: Number(f.value) })),
  });
}));

export default router;
