// داشبورد خلاصهٔ امروز (کارمند)
import { Router } from 'express';
import { pool } from '../db.js';
import { staffRequired } from '../auth.js';
import { wrap, toJalaliDate } from '../util.js';

const router = Router();
router.use(staffRequired);

router.get('/', wrap(async (req, res) => {
  // شیر دریافتی امروز (کیلو + ارزش)
  const [[milk]] = await pool.query(
    `SELECT COALESCE(SUM(weight_kg),0) AS kg, COALESCE(SUM(amount),0) AS value,
            COUNT(DISTINCT person_id) AS farmers
       FROM milk_deliveries
      WHERE DATE(delivered_at) = CURDATE() AND deleted_at IS NULL`);

  // کالاهای تحویلی امروز (فروش/خوراک) و علی‌الحساب/برداشت امروز و دریافت از مشتری امروز
  const [[tx]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN tx_type IN ('PRODUCT_SALE','FEED_SALE') THEN amount END),0) AS goods,
       COALESCE(SUM(CASE WHEN tx_type IN ('PAYMENT_OUT','CASH_WITHDRAWAL') THEN amount END),0) AS onaccount,
       COALESCE(SUM(CASE WHEN tx_type='PAYMENT_IN' THEN amount END),0) AS received
     FROM transactions
     WHERE DATE(tx_date) = CURDATE() AND status='active'`);

  // شیر امروز به تفکیک دامدار + کالای خریداری‌شدهٔ امروز همان شخص
  const [byFarmer] = await pool.query(
    `SELECT p.id, p.fullname,
            SUM(md.weight_kg) AS kg, SUM(md.amount) AS value,
            (SELECT COALESCE(SUM(t.amount),0) FROM transactions t
              WHERE t.person_id=p.id AND t.status='active'
                AND t.tx_type IN ('PRODUCT_SALE','FEED_SALE')
                AND DATE(t.tx_date)=CURDATE()) AS goods
       FROM milk_deliveries md
       JOIN persons p ON p.id = md.person_id
      WHERE DATE(md.delivered_at) = CURDATE() AND md.deleted_at IS NULL
      GROUP BY p.id ORDER BY kg DESC LIMIT 30`);

  res.json({
    date_jalali: toJalaliDate(new Date()),
    milk_today: { kg: Number(milk.kg), value: Number(milk.value), farmers: milk.farmers },
    goods_today: Number(tx.goods),
    onaccount_today: Number(tx.onaccount),
    received_today: Number(tx.received),
    by_farmer: byFarmer.map((f) => ({
      id: f.id, fullname: f.fullname,
      kg: Number(f.kg), value: Number(f.value), goods: Number(f.goods),
    })),
  });
}));

export default router;
