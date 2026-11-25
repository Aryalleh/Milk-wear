import { Router } from 'express';
import { pool } from '../db.js';
import { AppError, wrap } from '../util.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category, u.symbol AS unit,
            EXISTS(SELECT 1 FROM audit_logs a WHERE a.entity_type='products' AND a.entity_id=p.id AND a.action='fix_x10') AS price_fixed
       FROM products p
       LEFT JOIN product_categories c ON c.id = p.category_id
       LEFT JOIN units u ON u.id = p.unit_id
      WHERE p.is_active = 1 ORDER BY p.name`);
  res.json(rows);
}));

// کالاهای بایگانی/حذف‌شده (برای بازگردانی در تنظیمات)
router.get('/archived', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.code, p.name, c.name AS category, u.symbol AS unit
       FROM products p
       LEFT JOIN product_categories c ON c.id = p.category_id
       LEFT JOIN units u ON u.id = p.unit_id
      WHERE p.is_active = 0 AND p.is_raw_milk = 0 ORDER BY p.name`);
  res.json(rows);
}));

// بازگردانیِ کالای بایگانی‌شده
router.post('/:id/restore', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'دسترسی مجاز نیست');
  const [r] = await pool.query('UPDATE products SET is_active = 1 WHERE id = ? AND is_active = 0', [req.params.id]);
  if (!r.affectedRows) throw new AppError(404, 'کالای بایگانی‌شده یافت نشد');
  res.json({ ok: true });
}));

// دسته‌ها و واحدها (برای فرم تعریف کالای جدید)
router.get('/meta', wrap(async (req, res) => {
  const [categories] = await pool.query('SELECT id, name FROM product_categories ORDER BY id');
  const [units] = await pool.query('SELECT id, name, symbol FROM units ORDER BY id');
  res.json({ categories, units });
}));

// تعریف کالای جدید (فقط کارمند)
router.post('/', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'فقط کارمندان می‌توانند کالا تعریف کنند');
  const { name, category_id, unit_id, base_price, track_stock, code } = req.body;
  if (!name) throw new AppError(400, 'نام کالا لازم است');
  const finalCode = (code && code.trim()) || `P${Date.now().toString().slice(-8)}`;

  const [[dup]] = await pool.query('SELECT id FROM products WHERE code = ?', [finalCode]);
  if (dup) throw new AppError(409, 'این کد کالا قبلاً ثبت شده');

  const [r] = await pool.query(
    `INSERT INTO products (code, name, category_id, unit_id, base_price, track_stock)
     VALUES (?,?,?,?,?,?)`,
    [finalCode, name, category_id || null, unit_id || null,
     Math.round(Number(base_price) || 0), track_stock === false ? 0 : 1]
  );
  res.status(201).json({ id: r.insertId, code: finalCode });
}));

// اصلاحِ «یک صفر کم» در قیمت پایهٔ کالاها (قیمت‌هایی که به خیالِ تومان، به ریال وارد شده‌اند) — فقط مدیر.
//  body: { ids: [..] } → base_price ×۱۰. هر کالا فقط یک‌بار (در audit_logs ثبت می‌شود). فاکتورهای قبلی تغییر نمی‌کنند.
router.post('/fix-zero', wrap(async (req, res) => {
  if (req.user.kind !== 'staff' || req.user.role !== 'admin') throw new AppError(403, 'فقط مدیر');
  const ids = [...new Set((req.body?.ids || []).map(Number).filter((x) => x > 0))];
  if (!ids.length) throw new AppError(400, 'هیچ کالایی انتخاب نشده');
  const done = [], skipped = [];
  for (const id of ids) {
    const [[p]] = await pool.query('SELECT id, name, base_price FROM products WHERE id=?', [id]);
    if (!p) { skipped.push({ id, reason: 'یافت نشد' }); continue; }
    const [[f]] = await pool.query("SELECT id FROM audit_logs WHERE entity_type='products' AND entity_id=? AND action='fix_x10' LIMIT 1", [id]);
    if (f) { skipped.push({ id, name: p.name, reason: 'قبلاً اصلاح شده' }); continue; }
    const newPrice = Number(p.base_price) * 10;
    await pool.query('UPDATE products SET base_price=? WHERE id=?', [newPrice, id]);
    await pool.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, old_json, new_json, user_id, reason)
       VALUES ('products', ?, 'fix_x10', ?, ?, ?, 'اصلاح یک صفر کم در قیمت')`,
      [id, JSON.stringify({ base_price: Number(p.base_price) }), JSON.stringify({ base_price: newPrice }), req.user.uid || null]);
    done.push({ id, name: p.name, old: Number(p.base_price), new: newPrice });
  }
  res.json({ ok: true, done, skipped });
}));

// ویرایش کالا (قیمت پایه / حد نرمال موجودی / نام / فعال)
router.put('/:id', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'دسترسی مجاز نیست');
  const { name, base_price, reorder_level, is_active, unit_id, category_id } = req.body;
  const [r] = await pool.query(
    `UPDATE products SET
       name = COALESCE(?, name),
       base_price = COALESCE(?, base_price),
       reorder_level = COALESCE(?, reorder_level),
       is_active = COALESCE(?, is_active),
       unit_id = COALESCE(?, unit_id),
       category_id = COALESCE(?, category_id)
     WHERE id = ?`,
    [name ?? null, base_price ?? null, reorder_level ?? null, is_active ?? null,
     unit_id ?? null, category_id ?? null, req.params.id]);
  if (!r.affectedRows) throw new AppError(404, 'کالا یافت نشد');
  res.json({ ok: true });
}));

// حذف کالا — اگر در سوابق (فروش/انبار/تولید/ضایعات) استفاده شده باشد آرشیو می‌شود
// (is_active=0 و از لیست‌ها حذف می‌شود)، وگرنه حذفِ کامل. «شیر خام» قابل حذف نیست.
router.delete('/:id', wrap(async (req, res) => {
  if (req.user.kind !== 'staff') throw new AppError(403, 'دسترسی مجاز نیست');
  const id = Number(req.params.id);
  const [[p]] = await pool.query('SELECT * FROM products WHERE id = ? AND is_active = 1', [id]);
  if (!p) throw new AppError(404, 'کالا یافت نشد');
  if (p.is_raw_milk) throw new AppError(400, 'کالای «شیر خام» قابل حذف نیست');

  let referenced = false;
  for (const t of ['order_items', 'stock_movements', 'production_inputs', 'production_outputs', 'waste_log']) {
    const [[c]] = await pool.query(`SELECT COUNT(*) c FROM \`${t}\` WHERE product_id = ?`, [id]);
    if (c.c > 0) { referenced = true; break; }
  }

  if (referenced) {
    await pool.query('UPDATE products SET is_active = 0 WHERE id = ?', [id]);
  } else {
    await pool.query('DELETE FROM stock_balances WHERE product_id = ?', [id]);
    await pool.query('DELETE FROM products WHERE id = ?', [id]);
  }
  await pool.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, old_json, user_id, reason)
     VALUES ('products', ?, 'delete', ?, ?, ?)`,
    [id, JSON.stringify({ id: p.id, code: p.code, name: p.name }), req.user?.uid || null, req.body?.reason || null]);
  res.json({ ok: true, archived: referenced });
}));

export default router;
