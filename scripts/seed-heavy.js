// سیدِ سنگینِ فروش/تحویل شیر/پرداخت/خرید برای ۳۶ روز گذشته (برای تست)
//   اجرا:  node scripts/seed-heavy.js
import 'dotenv/config';
import mysql from 'mysql2/promise';
import crypto from 'crypto';
import jalaali from 'jalaali-js';
import { recomputeBalance } from '../src/ledger.js';

const DAYS = 36;
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const ymJ = (d) => { const { jy, jm } = jalaali.toJalaali(d); return `${jy}-${String(jm).padStart(2, '0')}`; };
const dtStr = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

const FARMERS = ['حاج رحیم گله‌دار', 'مشهدی قربان', 'کربلایی نصرت', 'دامداری برادران کریمی', 'حسین چوپان', 'اصغر آقا', 'دامداری سبز دشت', 'مرتضی رمه‌دار'];
const CUSTOMERS = ['سوپرمارکت میلاد', 'لبنیات پاک', 'فروشگاه رفاه', 'بقالی حسن', 'هایپر ستاره', 'کافه رستوران ونک', 'سوپر گل‌ها', 'مینی‌مارکت آفتاب', 'فروشگاه زنجیره‌ای اطلس', 'قنادی شیرین', 'سوپر پروتئین', 'رستوران سنتی', 'فروشگاه تعاونی', 'مغازهٔ سر کوچه', 'هتل پارسیان', 'کترینگ مهر', 'سوپر ۲۴', 'بستنی‌فروشی برفی'];
// محصولات لبنی برای فروش: [کد, نام, واحدId, قیمت, category]
const DAIRY = [
  ['MST', 'ماست پرچرب', 1, 65000, 1],
  ['MSTK', 'ماست کم‌چرب', 1, 58000, 1],
  ['PAN', 'پنیر تازه', 1, 180000, 1],
  ['KAR', 'کره محلی', 4, 250000, 1],
  ['DOO', 'دوغ سنتی', 3, 45000, 1],
  ['SHR', 'شیر پاستوریزه', 3, 42000, 1],
  ['KHA', 'خامه', 2, 90000, 1],
  ['GHR', 'قره‌قروت', 1, 120000, 1],
];

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    multipleStatements: true,
  });
  const q = (sql, p) => db.query(sql, p);
  const branchId = 1, warehouseId = 1;

  console.log('→ محصولات لبنی…');
  const prodIds = {};
  for (const [code, name, unitId, price] of DAIRY) {
    const [[ex]] = await q('SELECT id FROM products WHERE name=?', [name]);
    if (ex) { prodIds[code] = ex.id; await q('UPDATE products SET base_price=?, track_stock=1 WHERE id=?', [price, ex.id]); }
    else {
      const [r] = await q('INSERT INTO products (code,name,category_id,unit_id,base_price,is_raw_milk,track_stock,is_active) VALUES (?,?,?,?,?,0,1,1)',
        [code, name, 1, unitId, price]);
      prodIds[code] = r.insertId;
    }
  }
  const prodList = Object.entries(prodIds).map(([code, id]) => ({ id, price: DAIRY.find((d) => d[0] === code)[3] }));

  // موجودی اولیهٔ انبار (تا فروش‌ها منفی نشوند)
  const startDate = new Date(); startDate.setDate(startDate.getDate() - DAYS);
  for (const p of prodList) {
    await q(`INSERT INTO stock_movements (branch_id,warehouse_id,product_id,direction,quantity,source_type,created_by) VALUES (?,?,?, 'in', ?, 'adjustment', 1)`,
      [branchId, warehouseId, p.id, 100000]);
    await q(`INSERT INTO stock_balances (warehouse_id,product_id,quantity,last_movement_at) VALUES (?,?,?,NOW())
             ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity)`, [warehouseId, p.id, 100000]);
  }

  console.log('→ قیمت شیر ماه‌ها…');
  const months = new Set();
  for (let i = 0; i <= DAYS; i++) { const d = new Date(); d.setDate(d.getDate() - i); months.add(ymJ(d)); }
  for (const m of months) {
    const [[ex]] = await q("SELECT id FROM milk_price_history WHERE year_month_jalali=? AND person_id IS NULL", [m]);
    if (!ex) await q('INSERT INTO milk_price_history (year_month_jalali, person_id, price_per_kg) VALUES (?,NULL,?)', [m, 480000]);
  }

  console.log('→ اشخاص…');
  const farmerIds = [], customerIds = [];
  async function addPerson(name, type, arr) {
    const code = (type === 'farmer' ? 'F' : 'C') + Date.now().toString().slice(-6) + rnd(10, 99);
    const [r] = await q('INSERT INTO persons (person_code, fullname, mobile, address) VALUES (?,?,?,?)',
      [code, name, '09' + rnd(100000000, 999999999), pick(['قم', 'تهران', 'کرج', 'اصفهان']) + '، خیابان ' + rnd(1, 40)]);
    const [[pt]] = await q("SELECT id FROM person_types WHERE `key`=?", [type]);
    await q('INSERT IGNORE INTO person_roles (person_id, person_type_id) VALUES (?,?)', [r.insertId, pt.id]);
    arr.push(r.insertId);
  }
  for (const n of FARMERS) await addPerson(n, 'farmer', farmerIds);
  for (const n of CUSTOMERS) await addPerson(n, 'customer', customerIds);

  // درج مستقیم تراکنش با تاریخ گذشته
  async function tx(personId, type, dir, amount, desc, srcType, srcId, date, ym) {
    await q(`INSERT INTO transactions (branch_id,person_id,tx_type,direction,amount,year_month_jalali,source_type,source_id,description,created_by,tx_date)
             VALUES (?,?,?,?,?,?,?,?,?,1,?)`, [branchId, personId, type, dir, amount, ym, srcType, srcId || null, desc, date]);
  }

  console.log(`→ داده برای ${DAYS} روز…`);
  let orderSeq = 0, nOrders = 0, nMilk = 0, nPay = 0, saleTotal = 0;
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ym = ymJ(d);
    const { jy, jm, jd } = jalaali.toJalaali(d);
    const stamp = (h) => { const x = new Date(d); x.setHours(h, rnd(0, 59), rnd(0, 59), 0); return dtStr(x); };

    // ---- تحویل شیر از دامداران (صبح) ----
    for (const fid of farmerIds) {
      if (!chance(0.85)) continue;
      const kg = rnd(40, 320), fat = (rnd(30, 42) / 10), price = 480000;
      const amount = Math.round(kg * price);
      const date = stamp(7);
      const [md] = await q(`INSERT INTO milk_deliveries (branch_id,person_id,shift,year_month_jalali,weight_kg,fat_pct,price_per_kg,amount,created_by,delivered_at)
                            VALUES (?,?, 'morning', ?,?,?,?,?,1,?)`, [branchId, fid, ym, kg, fat, price, amount, date]);
      await tx(fid, 'MILK_DELIVERY', 'credit', amount, `شیر صبح — ${kg} کیلو`, 'milk_delivery', md.insertId, date, ym);
      nMilk++;
    }

    // ---- فروش‌ها (سنگین): ۸ تا ۱۸ سفارش در روز ----
    const ordersToday = rnd(8, 18);
    for (let k = 0; k < ordersToday; k++) {
      const cid = pick(customerIds);
      const nItems = rnd(1, 4);
      const lines = [];
      let total = 0;
      for (let j = 0; j < nItems; j++) { const p = pick(prodList); const qty = rnd(1, 25); const amt = qty * p.price; total += amt; lines.push({ p, qty, amt }); }
      const fulfill = chance(0.5) ? 'delivery' : 'pickup';
      const status = fulfill === 'pickup' ? 'delivered' : pick(['queued', 'delivered', 'delivered']);
      // پرداخت: ۵۵٪ کامل، ۲۵٪ جزئی، ۲۰٪ نسیه
      let paid = 0; const r = Math.random();
      if (r < 0.55) paid = total; else if (r < 0.8) paid = Math.round(total * (rnd(30, 80) / 100));
      const date = stamp(rnd(9, 20));
      orderSeq++;
      const orderNo = `${jy}${String(jm).padStart(2, '0')}${String(jd).padStart(2, '0')}-${orderSeq}`;
      const [o] = await q(`INSERT INTO orders (branch_id,order_no,waybill_no,person_id,channel,fulfillment_type,status,warehouse_id,total_amount,paid_amount,destination,created_by,ordered_at)
                           VALUES (?,?,?,?, 'distribution', ?, ?, ?,?,?,?,1,?)`,
        [branchId, orderNo, orderNo, cid, fulfill, status, warehouseId, total, paid, fulfill === 'delivery' ? (pick(['قم، بلوار', 'تهران، خ', 'کرج، م']) + rnd(1, 90)) : null, date]);
      for (const ln of lines) {
        await q('INSERT INTO order_items (order_id,product_id,quantity,unit_price,amount) VALUES (?,?,?,?,?)', [o.insertId, ln.p.id, ln.qty, ln.p.price, ln.amt]);
        await q(`INSERT INTO stock_movements (branch_id,warehouse_id,product_id,direction,quantity,source_type,source_id,created_by) VALUES (?,?,?, 'out', ?, 'sale', ?, 1)`,
          [branchId, warehouseId, ln.p.id, ln.qty, o.insertId]);
        await q(`INSERT INTO stock_balances (warehouse_id,product_id,quantity,last_movement_at) VALUES (?,?,?,NOW()) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity)`,
          [warehouseId, ln.p.id, -ln.qty]);
      }
      await tx(cid, 'PRODUCT_SALE', 'debit', total, lines.map((l) => `کالا×${l.qty}`).join('، '), 'order', o.insertId, date, ym);
      if (paid > 0) {
        const [pay] = await q(`INSERT INTO payments (branch_id,person_id,direction,method,amount,note,created_by,paid_at) VALUES (?,?, 'in', 'cash', ?, 'دریافت فروش', 1, ?)`, [branchId, cid, paid, date]);
        await tx(cid, 'PAYMENT_IN', 'credit', paid, 'دریافت هنگام فروش', 'payment', pay.insertId, date, ym);
      }
      const token = crypto.randomBytes(16).toString('hex');
      await q(`INSERT INTO receipts (branch_id,receipt_no,public_token,person_id,year_month_jalali,order_id,milk_amount,purchase_amount,net_amount,balance_after,created_by,issued_at)
               VALUES (?,?,?,?,?,?,0,?,?,0,1,?)`, [branchId, 'RC' + Date.now().toString().slice(-8) + orderSeq, token, cid, ym, o.insertId, total, -total, date]);
      nOrders++; saleTotal += total;
    }

    // ---- گاهی: پرداخت به دامدار / خرید از دامدار ----
    if (chance(0.6)) { const fid = pick(farmerIds); const amt = rnd(2, 15) * 1000000; const date = stamp(18);
      const [pay] = await q(`INSERT INTO payments (branch_id,person_id,direction,method,amount,note,created_by,paid_at) VALUES (?,?, 'out', 'cash', ?, 'علی‌الحساب', 1, ?)`, [branchId, fid, amt, date]);
      await tx(fid, 'PAYMENT_OUT', 'debit', amt, 'علی‌الحساب به دامدار', 'payment', pay.insertId, date, ym); nPay++; }
    if (chance(0.3)) { const fid = pick(farmerIds); const amt = rnd(1, 6) * 1000000; const date = stamp(17);
      await tx(fid, 'PURCHASE', 'credit', amt, 'خرید کالا از دامدار', 'manual', null, date, ym); }
  }

  console.log('→ بازمحاسبهٔ مانده‌ها…');
  for (const id of [...farmerIds, ...customerIds]) await recomputeBalance(db, id);

  // چند تسویهٔ کامل برای مشتری‌ها (تا «آخرین تسویه» داده داشته باشد)
  for (const cid of customerIds.slice(0, 4)) {
    await q('UPDATE account_balances SET last_settlement_at = ? WHERE person_id=?', [dtStr(new Date(Date.now() - rnd(3, 20) * 864e5)), cid]);
  }

  console.log(`\n✅ سید کامل شد:
  • ${farmerIds.length} دامدار، ${customerIds.length} مشتری
  • ${nMilk} تحویل شیر
  • ${nOrders} فروش (جمع ${saleTotal.toLocaleString('fa-IR')} ریال)
  • ${nPay} پرداخت به دامدار
  در بازهٔ ${DAYS} روز گذشته.`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
